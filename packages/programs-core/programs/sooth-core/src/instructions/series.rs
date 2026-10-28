//! Series: the protocol authority opens one per coin (feed × quote mint) and
//! may pause it; its volatility is learned from its feed's closes (a Pyth
//! feed, or a Raydium pool's average, `pool_oracle`), and a pool-fed series
//! may be seeded once (`series_seed`). Everything a round does after that is
//! permissionless.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::SoothCoreError;
use crate::math::calendar::DAY;
use crate::instructions::ladder::ORACLE_MIN_SIGNATURES;
use crate::oracle::observe_fit;
use crate::pool_oracle::{pool_price_at, price_for_instant, RAYDIUM_CLMM};
use crate::state::ladder::SETTLE_MAX_GAP_SECS;
use crate::state::series::{CLOCK_NEW_YORK, CLOCK_NEW_YORK_WEEKDAYS, CLOCK_UTC, VAR_MAX, VAR_MIN, WARMUP_OBSERVATIONS};
use crate::state::{ProtocolConfig, Series, PROTOCOL_CONFIG_SEED, SERIES_SEED};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SeriesCreateArgs {
    pub feed_id: [u8; 32],
    /// 0 for one round per calendar day; otherwise a fixed period (testing).
    pub period_secs: u32,
    /// Seconds after local midnight (daily) or into the period.
    pub close_secs: u32,
    pub clock: u8,
}

#[derive(Accounts)]
#[instruction(args: SeriesCreateArgs)]
pub struct SeriesCreate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = Series::SPACE,
        seeds = [SERIES_SEED, args.feed_id.as_ref(), quote_mint.key().as_ref(), &args.period_secs.to_le_bytes()],
        bump,
    )]
    pub series: Box<Account<'info, Series>>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct SeriesCreated {
    pub series: Pubkey,
    pub feed_id: [u8; 32],
    pub quote_mint: Pubkey,
    pub period_secs: u32,
    pub close_secs: u32,
    pub clock: u8,
}

pub fn series_create_handler(ctx: Context<SeriesCreate>, args: SeriesCreateArgs) -> Result<()> {
    let daily = args.period_secs == 0;
    let ok = (args.clock == CLOCK_UTC || args.clock == CLOCK_NEW_YORK || args.clock == CLOCK_NEW_YORK_WEEKDAYS)
        && if daily {
            // at or after 3 AM, so a close never sits on a daylight-saving switch
            (args.close_secs as i64) < DAY && (args.clock == CLOCK_UTC || args.close_secs >= 3 * 3600)
        } else {
            args.period_secs >= 60 && args.close_secs < args.period_secs && args.clock == CLOCK_UTC
        };
    require!(ok, SoothCoreError::SeriesBadParams);

    let s = &mut ctx.accounts.series;
    s.feed_id = args.feed_id;
    s.quote_mint = ctx.accounts.quote_mint.key();
    s.period_secs = args.period_secs;
    s.close_secs = args.close_secs;
    s.clock = args.clock;
    s.active = true;
    s.bump = ctx.bumps.series;
    // No volatility yet: it is learned from Pyth closes (`series_observe`).
    emit!(SeriesCreated {
        series: s.key(),
        feed_id: args.feed_id,
        quote_mint: s.quote_mint,
        period_secs: args.period_secs,
        close_secs: args.close_secs,
        clock: args.clock,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SeriesSet<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub series: Box<Account<'info, Series>>,
}

/// Stop or restart new rounds. Running rounds are untouched. A Pyth-fed
/// series' volatility cannot be set: it is learned from Pyth closes and
/// nothing else (a pool-fed one may be seeded once, `series_seed`).
pub fn series_set_handler(ctx: Context<SeriesSet>, active: bool) -> Result<()> {
    ctx.accounts.series.active = active;
    Ok(())
}

// ── seed ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct SeriesSeed<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub series: Box<Account<'info, Series>>,

    /// CHECK: the Raydium pool the series' feed id names: only a pool-fed
    /// series may be seeded.
    #[account(
        owner = RAYDIUM_CLMM @ SoothCoreError::SeriesNotSeedable,
        constraint = pool.key().to_bytes() == series.feed_id @ SoothCoreError::SeriesNotSeedable,
    )]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: the pool's observation account; verified in `pool_oracle`.
    pub observation: UncheckedAccount<'info>,
}

/// Start a pool-fed series, warm. A pool keeps about a day of history, so a
/// series on it can neither start twenty closes back nor learn them on
/// chain the way a Pyth-fed one does. Instead the authority measures the
/// variance off chain and seeds it, once, before the series is warmed up;
/// the series starts from the latest close, at the pool's own price for it.
/// From then on it learns every close like any series, and the seed fades at
/// 6% a day. The variance sets how wide a round's floors are, never which
/// floor a round settles on: that is the pool's price, which nobody chooses.
pub fn series_seed_handler(ctx: Context<SeriesSeed>, var_wad: i128) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = &mut ctx.accounts.series;
    require!(!s.warmed_up(), SoothCoreError::SeriesNotSeedable);
    let index = s.index_at_or_before(now);
    let at = s.close_of(index);
    let p = pool_price_at(&ctx.accounts.pool.to_account_info(), &ctx.accounts.observation.to_account_info(), &s.feed_id, at)?;
    s.var_wad = var_wad.clamp(VAR_MIN, VAR_MAX);
    s.observations = WARMUP_OBSERVATIONS;
    s.last_price = p.price;
    s.last_expo = p.exponent;
    s.last_at = at;
    emit!(SeriesObserved { series: s.key(), index, price: p.price, var_wad: s.variance(), observations: s.observations });
    Ok(())
}

// ── observe ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(index: u32)]
pub struct SeriesObserve<'info> {
    /// Anyone. Which price counts for a day is fixed by the settlement rule,
    /// not by who submits it.
    pub caller: Signer<'info>,

    #[account(mut)]
    pub series: Box<Account<'info, Series>>,

    /// CHECK: a Pyth `PriceUpdateV2`, or the Raydium pool the series' feed
    /// names (its observation account then the first remaining account);
    /// verified in `oracle` and `pool_oracle`.
    pub price_update: UncheckedAccount<'info>,
}

#[event]
pub struct SeriesObserved {
    pub series: Pubkey,
    pub index: u32,
    pub price: i64,
    /// `Series::variance`: zero while a restarted warm-up has learned nothing.
    pub var_wad: i128,
    pub observations: u32,
}

/// Teach a series one day's close, whether or not anyone funded a round that
/// day. Anyone may submit it, from Pyth's history, so the series never
/// depends on a keeper or on rounds to learn. The update is THE one for the
/// close (the first published at or after it, `prev_publish_time < at <=
/// publish_time`), or, for a past close, the first one the push feed took
/// after it, rebuilt from chain history (`oracle::observe_fit`). If it is a
/// good price for the instant (close enough to it, confidence under 1%), the
/// series learns the move since the last close; if not, it only moves on to
/// this close (`Series::rebase`). Either way every day is taken, in order
/// (`Series::may_observe`), so nobody chooses which days a series learns from.
pub fn series_observe_handler(ctx: Context<SeriesObserve>, index: u32) -> Result<()> {
    let s = &mut ctx.accounts.series;
    require!(s.has_round(index), SoothCoreError::LadderBadTimes);
    let at = s.close_of(index);
    require!(at != s.last_at, SoothCoreError::SeriesAlreadyObserved);
    require!(s.may_observe(index, Clock::get()?.unix_timestamp), SoothCoreError::SeriesOutOfOrder);
    let (p, push) = price_for_instant(&ctx.accounts.price_update.to_account_info(), ctx.remaining_accounts, &s.feed_id, at)?;
    if observe_fit(&p, &s.feed_id, ORACLE_MIN_SIGNATURES, at, SETTLE_MAX_GAP_SECS, push)? {
        s.observe(p.price, p.exponent, at).map_err(|_| error!(SoothCoreError::MathOverflow))?;
    } else {
        s.rebase(p.price, p.exponent, at);
    }
    emit!(SeriesObserved { series: s.key(), index, price: p.price, var_wad: s.variance(), observations: s.observations });
    Ok(())
}

//! Series: the protocol authority opens one per coin (feed × quote mint) and
//! may pause it or reset its volatility. Everything a round does after that
//! is permissionless.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::SoothCoreError;
use crate::math::calendar::DAY;
use crate::instructions::ladder::ORACLE_MIN_SIGNATURES;
use crate::oracle::{check_settlement_instant, read_price_update};
use crate::state::ladder::SETTLE_MAX_GAP_SECS;
use crate::state::series::{CLOCK_NEW_YORK, CLOCK_NEW_YORK_WEEKDAYS, CLOCK_UTC};
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

/// Stop or restart new rounds. Running rounds are untouched. There is no way
/// to set a series' volatility: it is learned from Pyth closes and nothing else.
pub fn series_set_handler(ctx: Context<SeriesSet>, active: bool) -> Result<()> {
    ctx.accounts.series.active = active;
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

    /// CHECK: a Pyth `PriceUpdateV2`; verified in `oracle`.
    pub price_update: UncheckedAccount<'info>,
}

#[event]
pub struct SeriesObserved {
    pub series: Pubkey,
    pub index: u32,
    pub price: i64,
    pub var_wad: i128,
    pub observations: u32,
}

/// Teach a series one day's close, whether or not anyone funded a round that
/// day: the Pyth update that is the price at `close_of(index)` under the same
/// rule a settlement uses (the first published at or after the close, within
/// 30 seconds). Days go in order, and missed ones can be submitted later from
/// Pyth's history, so the series never depends on a keeper or on rounds to
/// learn.
pub fn series_observe_handler(ctx: Context<SeriesObserve>, index: u32) -> Result<()> {
    let s = &mut ctx.accounts.series;
    require!(s.has_round(index), SoothCoreError::LadderBadTimes);
    let at = s.close_of(index);
    // In order, except that a series which has learned nothing yet may start
    // from an earlier close (`Series::observe`).
    require!(at > s.last_at || (s.observations == 0 && at != s.last_at), SoothCoreError::SeriesAlreadyObserved);
    let p = read_price_update(&ctx.accounts.price_update.to_account_info())?;
    // Confidence under 1% of the price: this price only measures a move.
    check_settlement_instant(&p, &s.feed_id, ORACLE_MIN_SIGNATURES, at, SETTLE_MAX_GAP_SECS, 200)?;
    s.observe(p.price, p.exponent, at).map_err(|_| error!(SoothCoreError::MathOverflow))?;
    emit!(SeriesObserved { series: s.key(), index, price: p.price, var_wad: s.var_wad, observations: s.observations });
    Ok(())
}

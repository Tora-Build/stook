//! Series: the protocol authority opens one per coin (feed × quote mint) and
//! may pause it or reset its volatility. Everything a round does after that
//! is permissionless.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::SoothCoreError;
use crate::math::calendar::DAY;
use crate::state::series::{CLOCK_NEW_YORK, CLOCK_NEW_YORK_WEEKDAYS, CLOCK_UTC, VAR_MAX, VAR_MIN};
use crate::state::{ProtocolConfig, Series, PROTOCOL_CONFIG_SEED, SERIES_SEED};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SeriesCreateArgs {
    pub feed_id: [u8; 32],
    /// 0 for one round per calendar day; otherwise a fixed period (testing).
    pub period_secs: u32,
    /// Seconds after local midnight (daily) or into the period.
    pub close_secs: u32,
    pub clock: u8,
    /// Starting variance of daily log returns, WAD: the anchor's recent
    /// history, measured off chain once. Settlements take over from there.
    pub var_wad: i128,
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
    pub var_wad: i128,
}

pub fn series_create_handler(ctx: Context<SeriesCreate>, args: SeriesCreateArgs) -> Result<()> {
    let daily = args.period_secs == 0;
    let ok = (args.clock == CLOCK_UTC || args.clock == CLOCK_NEW_YORK || args.clock == CLOCK_NEW_YORK_WEEKDAYS)
        && (args.var_wad >= VAR_MIN && args.var_wad <= VAR_MAX)
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
    s.var_wad = args.var_wad;
    emit!(SeriesCreated {
        series: s.key(),
        feed_id: args.feed_id,
        quote_mint: s.quote_mint,
        period_secs: args.period_secs,
        close_secs: args.close_secs,
        clock: args.clock,
        var_wad: args.var_wad,
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

/// Stop or restart new rounds, or reset the volatility after a regime the
/// settlements have not caught up with (a listing, a halt). Rounds already
/// created keep the band width they were created with.
pub fn series_set_handler(ctx: Context<SeriesSet>, active: Option<bool>, var_wad: Option<i128>) -> Result<()> {
    let s = &mut ctx.accounts.series;
    if let Some(a) = active {
        s.active = a;
    }
    if let Some(v) = var_wad {
        require!(v >= VAR_MIN && v <= VAR_MAX, SoothCoreError::SeriesBadParams);
        s.var_wad = v;
    }
    Ok(())
}

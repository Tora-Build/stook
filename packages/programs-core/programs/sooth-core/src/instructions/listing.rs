//! Listing a coin (`state::listing`): the protocol keeps the anchors and the
//! fee; anyone lists, anyone activates a listing once its day has passed, and
//! the protocol may turn a listing down before then.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::SoothCoreError;
use crate::instructions::ladder::{one_token, pull};
use crate::state::house::*;
use crate::state::listing::*;
use crate::state::series::{CLOCK_NEW_YORK, CLOCK_NEW_YORK_WEEKDAYS, CLOCK_UTC};
use crate::state::{require_not_paused, ProtocolConfig, Series, PROTOCOL_CONFIG_SEED, SERIES_SEED};

// ── the protocol's part ──────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ListAnchorArgs {
    pub feed_id: [u8; 32],
    pub clock: u8,
    /// Seconds after local midnight the daily round closes.
    pub close_secs: u32,
    pub active: bool,
}

#[derive(Accounts)]
#[instruction(args: ListAnchorArgs)]
pub struct ListAnchorSet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = ListAnchor::SPACE,
        seeds = [LIST_ANCHOR_SEED, args.feed_id.as_ref()],
        bump,
    )]
    pub anchor: Box<Account<'info, ListAnchor>>,

    pub system_program: Program<'info, System>,
}

/// Add an anchor to the list, change its clock, or take it off (`active`
/// false). Coins already listed on it keep their series as it was.
pub fn list_anchor_set_handler(ctx: Context<ListAnchorSet>, args: ListAnchorArgs) -> Result<()> {
    let ok = (args.clock == CLOCK_UTC || args.clock == CLOCK_NEW_YORK || args.clock == CLOCK_NEW_YORK_WEEKDAYS)
        && (args.close_secs as i64) < crate::math::calendar::DAY
        && (args.clock == CLOCK_UTC || args.close_secs >= 3 * 3600);
    require!(ok, SoothCoreError::SeriesBadParams);
    let a = &mut ctx.accounts.anchor;
    a.feed_id = args.feed_id;
    a.clock = args.clock;
    a.close_secs = args.close_secs;
    a.active = args.active;
    a.bump = ctx.bumps.anchor;
    Ok(())
}

#[derive(Accounts)]
pub struct ListFeeSet<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,
}

pub fn list_fee_set_handler(ctx: Context<ListFeeSet>, lamports: u64) -> Result<()> {
    ctx.accounts.config.list_fee_lamports = lamports;
    Ok(())
}

// ── list ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CoinList<'info> {
    #[account(mut)]
    pub lister: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    /// CHECK: the treasury the config names; it only receives the fee.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        seeds = [LIST_ANCHOR_SEED, anchor.feed_id.as_ref()],
        bump = anchor.bump,
        constraint = anchor.active @ SoothCoreError::ListAnchorInactive,
    )]
    pub anchor: Box<Account<'info, ListAnchor>>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The coin's daily series on this anchor: one listing per coin and anchor.
    #[account(
        init,
        payer = lister,
        space = Series::SPACE,
        seeds = [SERIES_SEED, anchor.feed_id.as_ref(), quote_mint.key().as_ref(), &0u32.to_le_bytes()],
        bump,
    )]
    pub series: Box<Account<'info, Series>>,

    #[account(init, payer = lister, space = House::SPACE, seeds = [HOUSE_SEED, series.key().as_ref()], bump)]
    pub house: Box<Account<'info, House>>,

    #[account(
        init,
        payer = lister,
        seeds = [HOUSE_VAULT_SEED, house.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = house,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(init, payer = lister, space = HouseStake::SPACE, seeds = [HOUSE_STAKE_SEED, house.key().as_ref(), lister.key().as_ref()], bump)]
    pub stake: Box<Account<'info, HouseStake>>,

    #[account(mut, token::mint = quote_mint, token::authority = lister, token::token_program = token_program)]
    pub lister_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [crate::state::ladder::MINT_APPROVAL_SEED, quote_mint.key().as_ref()], bump = mint_approval.bump)]
    pub mint_approval: Option<Box<Account<'info, crate::state::MintApproval>>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct CoinListed {
    pub series: Pubkey,
    pub house: Pubkey,
    pub quote_mint: Pubkey,
    pub feed_id: [u8; 32],
    pub lister: Pubkey,
    pub seed: u64,
    pub opens_after: i64,
    pub locked_until: i64,
}

/// List a coin: its daily series on `anchor` (paused for a day), its house,
/// and `seed` of the coin in the house as the lister's stake, locked a week.
/// `seed` is what the house is credited; a coin with a transfer fee takes a
/// little more from the wallet, at most `max_gross`.
pub fn coin_list_handler(ctx: Context<CoinList>, seed: u64, max_gross: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    crate::token_guard::assert_mint_allowed(&ctx.accounts.quote_mint.to_account_info(), ctx.accounts.mint_approval.is_some())?;
    let (min, max) = seed_bounds(ctx.accounts.quote_mint.supply);
    require!(seed >= min.max(one_token(ctx.accounts.quote_mint.decimals)?), SoothCoreError::ListSeedTooSmall);
    require!(seed <= max, SoothCoreError::ListSeedTooLarge);

    let fee = ctx.accounts.config.list_fee_lamports;
    if fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer { from: ctx.accounts.lister.to_account_info(), to: ctx.accounts.treasury.to_account_info() },
            ),
            fee,
        )?;
    }
    pull(
        seed,
        max_gross,
        &ctx.accounts.lister_token.to_account_info(),
        &ctx.accounts.lister.to_account_info(),
        &ctx.accounts.quote_mint,
        &mut ctx.accounts.vault,
        &ctx.accounts.token_program,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts.anchor;
    let s = &mut ctx.accounts.series;
    s.feed_id = a.feed_id;
    s.quote_mint = ctx.accounts.quote_mint.key();
    s.period_secs = 0;
    s.close_secs = a.close_secs;
    s.clock = a.clock;
    s.active = false;
    s.bump = ctx.bumps.series;

    let series_key = s.key();
    let house_key = ctx.accounts.house.key();
    let h = &mut ctx.accounts.house;
    h.series = series_key;
    h.quote_mint = s.quote_mint;
    h.vault = ctx.accounts.vault.key();
    h.bump = ctx.bumps.house;
    h.vault_bump = ctx.bumps.vault;
    h.opens_after = now + LIST_DELAY_SECS;
    let shares = shares_for(seed, 0, 0).ok_or(SoothCoreError::MathOverflow)?;
    h.assets = seed;
    h.total_shares = shares;

    let k = &mut ctx.accounts.stake;
    k.house = house_key;
    k.owner = ctx.accounts.lister.key();
    k.shares = shares;
    k.generation = h.generation;
    k.bump = ctx.bumps.stake;
    k.locked_until = now + LIST_LOCK_SECS;

    emit!(CoinListed {
        series: series_key,
        house: house_key,
        quote_mint: h.quote_mint,
        feed_id: a.feed_id,
        lister: k.owner,
        seed,
        opens_after: h.opens_after,
        locked_until: k.locked_until,
    });
    Ok(())
}

// ── go live, or not ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CoinActivate<'info> {
    #[account(mut, seeds = [HOUSE_SEED, series.key().as_ref()], bump = house.bump)]
    pub house: Box<Account<'info, House>>,

    #[account(mut)]
    pub series: Box<Account<'info, Series>>,
}

/// A listing's day has passed: its series goes live. Anyone.
pub fn coin_activate_handler(ctx: Context<CoinActivate>) -> Result<()> {
    let h = &mut ctx.accounts.house;
    require!(h.opens_after != 0, SoothCoreError::ListNotPending);
    require!(h.opens_after != HOUSE_REJECTED, SoothCoreError::ListRejected);
    require!(Clock::get()?.unix_timestamp >= h.opens_after, SoothCoreError::ListNotYet);
    h.opens_after = 0;
    ctx.accounts.series.active = true;
    Ok(())
}

#[derive(Accounts)]
pub struct CoinReject<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub house: Box<Account<'info, House>>,
}

/// Turn a listing down before it goes live: its series never starts and its
/// seed may be withdrawn at once. The protocol authority.
pub fn coin_reject_handler(ctx: Context<CoinReject>) -> Result<()> {
    let h = &mut ctx.accounts.house;
    require!(h.opens_after != 0 && h.opens_after != HOUSE_REJECTED, SoothCoreError::ListNotPending);
    h.opens_after = HOUSE_REJECTED;
    Ok(())
}

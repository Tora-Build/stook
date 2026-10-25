//! The house: one standing pool per series that rolls from round to round
//! (`state::house`). Every instruction here is permissionless except a
//! depositor's own deposit, withdrawal, cancel and claim.
//!
//! A day of a house: the keeper settles yesterday's round, `house_collect`
//! books the house's tranche home and processes the queue at the price the
//! round left, `house_start` starts today's round with as much as its
//! trading can carry (`commit_for`), and the round opens. Deposits and withdrawals asked for during the
//! day wait for the next collect.
//!
//! Every round a house starts keeps its money in the house's own vault (a
//! shared vault, `VAULT_SHARED`), so rolling from one round to the next moves
//! no tokens at all: a coin that takes a fee on every transfer loses nothing
//! between rounds. Tokens move only when someone deposits, withdraws, trades
//! or collects, exactly as on any round.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::SoothCoreError;
use crate::instructions::ladder::{init_round, join, one_token, pull, round_window, take_tranche_owed};
use crate::state::house::*;
use crate::state::ladder::*;
use crate::state::{require_not_paused, ProtocolConfig, Series, PROTOCOL_CONFIG_SEED};

fn send<'info>(
    amount: u64,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    seeds: &[&[&[u8]]],
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked { from: from.to_account_info(), mint: mint.to_account_info(), to: to.clone(), authority: authority.clone() },
            seeds,
        ),
        amount,
        mint.decimals,
    )
}

/// Bring a stake up to date: its queued entry, if its epoch has ended, at
/// that epoch's price; and its shares, if a round since voided them.
fn book(stake: &mut HouseStake, house: &House, epoch: Option<&HouseEpoch>) -> Result<()> {
    if stake.has_pending() && stake.pending_epoch < house.epoch {
        let e = epoch.ok_or(SoothCoreError::HouseEpochMissing)?;
        require!(e.house == stake.house && e.epoch == stake.pending_epoch, SoothCoreError::HouseEpochMissing);
        book_from_epoch(stake, e).ok_or(SoothCoreError::MathOverflow)?;
    }
    if stake.generation != house.generation && !stake.has_pending() {
        stake.shares = 0;
        stake.generation = house.generation;
    }
    Ok(())
}

// ── create ───────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HouseCreate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    pub series: Box<Account<'info, Series>>,

    /// One house per series.
    #[account(init, payer = payer, space = House::SPACE, seeds = [HOUSE_SEED, series.key().as_ref()], bump)]
    pub house: Box<Account<'info, House>>,

    #[account(address = series.quote_mint @ SoothCoreError::LadderWrongAccount)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        seeds = [HOUSE_VAULT_SEED, house.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = house,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MINT_APPROVAL_SEED, quote_mint.key().as_ref()], bump = mint_approval.bump)]
    pub mint_approval: Option<Box<Account<'info, MintApproval>>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn house_create_handler(ctx: Context<HouseCreate>) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    crate::token_guard::assert_mint_allowed(&ctx.accounts.quote_mint.to_account_info(), ctx.accounts.mint_approval.is_some())?;

    let h = &mut ctx.accounts.house;
    h.series = ctx.accounts.series.key();
    h.quote_mint = ctx.accounts.quote_mint.key();
    h.vault = ctx.accounts.vault.key();
    h.bump = ctx.bumps.house;
    h.vault_bump = ctx.bumps.vault;
    Ok(())
}

// ── deposit ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HouseDeposit<'info> {
    #[account(mut)]
    pub lp: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub house: Box<Account<'info, House>>,

    #[account(address = house.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = house.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = quote_mint, token::authority = lp, token::token_program = token_program)]
    pub lp_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = lp,
        space = HouseStake::SPACE,
        seeds = [HOUSE_STAKE_SEED, house.key().as_ref(), lp.key().as_ref()],
        bump,
    )]
    pub stake: Box<Account<'info, HouseStake>>,

    /// The record of the epoch the stake's queued entry belongs to, when that
    /// epoch has ended; otherwise absent.
    pub epoch: Option<Box<Account<'info, HouseEpoch>>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct HouseDeposited {
    pub house: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    /// Zero when queued: minted at the next collect.
    pub shares: u128,
}

/// Idle house: mint shares now, at the price of the moment. House in a
/// round: queue the deposit for the price after the round. `amount` is what
/// the house is credited; on a coin with a transfer fee the wallet sends a
/// little more, at most `max_gross`.
pub fn house_deposit_handler(ctx: Context<HouseDeposit>, amount: u64, max_gross: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require!(amount >= one_token(ctx.accounts.quote_mint.decimals)?, SoothCoreError::LadderSeedTooSmall);
    pull(
        amount,
        max_gross,
        &ctx.accounts.lp_token.to_account_info(),
        &ctx.accounts.lp.to_account_info(),
        &ctx.accounts.quote_mint,
        &mut ctx.accounts.vault,
        &ctx.accounts.token_program,
    )?;

    let house_key = ctx.accounts.house.key();
    let h = &mut ctx.accounts.house;
    let s = &mut ctx.accounts.stake;
    if s.house == Pubkey::default() {
        s.house = house_key;
        s.owner = ctx.accounts.lp.key();
        s.generation = h.generation;
        s.bump = ctx.bumps.stake;
    }
    book(s, h, ctx.accounts.epoch.as_deref().map(|a| &**a))?;

    let shares = if h.idle() {
        let minted = shares_for(amount, h.assets, h.total_shares).ok_or(SoothCoreError::MathOverflow)?;
        h.assets = h.assets.checked_add(amount).ok_or(SoothCoreError::MathOverflow)?;
        h.total_shares = h.total_shares.checked_add(minted).ok_or(SoothCoreError::MathOverflow)?;
        s.shares = s.shares.checked_add(minted).ok_or(SoothCoreError::MathOverflow)?;
        minted
    } else {
        h.pending_deposits = h.pending_deposits.checked_add(amount).ok_or(SoothCoreError::MathOverflow)?;
        s.pending_deposit = s.pending_deposit.checked_add(amount).ok_or(SoothCoreError::MathOverflow)?;
        s.pending_epoch = h.epoch;
        0
    };
    emit!(HouseDeposited { house: house_key, owner: s.owner, amount, shares });
    Ok(())
}

// ── withdraw, cancel, claim ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HouseLp<'info> {
    pub lp: Signer<'info>,

    #[account(mut)]
    pub house: Box<Account<'info, House>>,

    #[account(
        mut,
        seeds = [HOUSE_STAKE_SEED, house.key().as_ref(), lp.key().as_ref()],
        bump = stake.bump,
    )]
    pub stake: Box<Account<'info, HouseStake>>,

    pub epoch: Option<Box<Account<'info, HouseEpoch>>>,

    #[account(address = house.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = house.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = quote_mint, token::authority = lp, token::token_program = token_program)]
    pub lp_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> HouseLp<'info> {
    fn pay(&self, amount: u64) -> Result<()> {
        let series = self.house.series;
        let seeds: &[&[&[u8]]] = &[&[HOUSE_SEED, series.as_ref(), &[self.house.bump]]];
        send(amount, &self.vault, &self.lp_token.to_account_info(), &self.house.to_account_info(), seeds, &self.quote_mint, &self.token_program)
    }
}

#[event]
pub struct HouseWithdrawn {
    pub house: Pubkey,
    pub owner: Pubkey,
    pub shares: u128,
    /// Zero when queued: paid at the next collect, then claimed.
    pub paid: u64,
}

/// Idle house: burn and pay now. House in a round: queue the shares; they
/// bear the round's result and are paid at the price after it. Never paused:
/// a pause must not hold anyone's money. Only a listed coin's seed waits out
/// its lock, which its lister agreed to (`coin_list`).
pub fn house_withdraw_handler(ctx: Context<HouseLp>, shares: u128) -> Result<()> {
    let house_key = ctx.accounts.house.key();
    let paid = {
        let h = &mut ctx.accounts.house;
        let s = &mut ctx.accounts.stake;
        book(s, h, ctx.accounts.epoch.as_deref().map(|a| &**a))?;
        // A listed coin's seed stays its week, unless the listing was turned down.
        require!(s.locked_until <= Clock::get()?.unix_timestamp || h.opens_after == crate::state::listing::HOUSE_REJECTED, SoothCoreError::HouseStakeLocked);
        let free = s.shares.checked_sub(s.pending_withdraw).ok_or(SoothCoreError::MathOverflow)?;
        require!(shares > 0 && shares <= free, SoothCoreError::HouseNotEnoughShares);
        if h.idle() {
            let paid = assets_for(shares, h.assets, h.total_shares).ok_or(SoothCoreError::MathOverflow)?;
            h.assets -= paid;
            h.total_shares -= shares;
            s.shares -= shares;
            paid
        } else {
            s.pending_withdraw += shares;
            s.pending_epoch = h.epoch;
            h.pending_withdraw_shares = h.pending_withdraw_shares.checked_add(shares).ok_or(SoothCoreError::MathOverflow)?;
            0
        }
    };
    ctx.accounts.pay(paid)?;
    emit!(HouseWithdrawn { house: house_key, owner: ctx.accounts.lp.key(), shares, paid });
    Ok(())
}

/// Take back a deposit still queued in the round in progress.
pub fn house_cancel_deposit_handler(ctx: Context<HouseLp>) -> Result<()> {
    let back = {
        let h = &mut ctx.accounts.house;
        let s = &mut ctx.accounts.stake;
        require!(!h.idle() && s.pending_epoch == h.epoch && s.pending_deposit > 0, SoothCoreError::HouseIdle);
        let back = s.pending_deposit;
        s.pending_deposit = 0;
        h.pending_deposits -= back;
        back
    };
    ctx.accounts.pay(back)
}

/// Collect processed withdrawals.
pub fn house_claim_handler(ctx: Context<HouseLp>) -> Result<()> {
    let owed = {
        let h = &mut ctx.accounts.house;
        let s = &mut ctx.accounts.stake;
        book(s, h, ctx.accounts.epoch.as_deref().map(|a| &**a))?;
        let owed = s.claimable.min(h.claimable);
        s.claimable = 0;
        h.claimable -= owed;
        owed
    };
    ctx.accounts.pay(owed)
}

// ── start a round ───────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(index: u32)]
pub struct HouseStart<'info> {
    /// Anyone. Pays the round's and the tranche's rent; gets the tranche's
    /// back at collect and the round's when it is closed.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut, seeds = [HOUSE_SEED, series.key().as_ref()], bump = house.bump)]
    pub house: Box<Account<'info, House>>,

    #[account(constraint = series.active @ SoothCoreError::SeriesInactive)]
    pub series: Box<Account<'info, Series>>,

    /// The day's one round, the same address `ladder_create` would use: a day
    /// the house starts is a day nobody else can start, and the other way
    /// round.
    #[account(
        init,
        payer = cranker,
        space = Ladder::SPACE,
        seeds = [LADDER_SEED, series.key().as_ref(), &index.to_le_bytes()],
        bump,
    )]
    pub ladder: AccountLoader<'info, Ladder>,

    #[account(address = house.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = cranker,
        space = LadderTranche::SPACE,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), house.key().as_ref(), &[0u8]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct HouseStarted {
    pub house: Pubkey,
    pub ladder: Pubkey,
    pub index: u32,
    pub amount: u64,
}

/// Start a round of the house's series with everything the house holds, its
/// money kept in the house's vault. Nobody has traded it, nobody can have:
/// it is created here. The house is its first and, until others join, only
/// depositor.
pub fn house_start_handler(ctx: Context<HouseStart>, index: u32) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    let now = Clock::get()?.unix_timestamp;
    let h = &ctx.accounts.house;
    require!(h.idle(), SoothCoreError::HouseBusy);
    // Sized to the fees the house has been earning; the rest waits in the vault.
    let amount = commit_for(h.assets, h.fee_ema);
    let decimals = ctx.accounts.quote_mint.decimals;
    require!(amount >= one_token(decimals)?, SoothCoreError::HouseTooSmall);
    let window = round_window(&ctx.accounts.series, index, now)?;

    {
        let mut l = ctx.accounts.ladder.load_init()?;
        init_round(
            &mut l,
            &ctx.accounts.series,
            index,
            window,
            h.quote_mint,
            decimals,
            h.vault,
            ctx.accounts.cranker.key(),
            h.key(),
        );
        l.vault_mode = VAULT_SHARED;
        l.authority_bump = h.bump;
        l.vault_bump = h.vault_bump;
        l.bump = ctx.bumps.ladder;

        let mut t = ctx.accounts.tranche.load_init()?;
        t.ladder = ctx.accounts.ladder.key();
        t.owner = h.key();
        t.index = 0;
        t.bump = ctx.bumps.tranche;
        // Bookkeeping only: the money is already in the vault the round uses.
        join(&mut l, &mut t, amount)?;
        l.open_tranches = 1;
    }

    let h = &mut ctx.accounts.house;
    h.round = ctx.accounts.ladder.key();
    h.rent_payer = ctx.accounts.cranker.key();
    h.in_round = amount;
    h.assets -= amount;
    h.last_index = index;
    emit!(HouseStarted { house: h.key(), ladder: h.round, index, amount });
    Ok(())
}

// ── collect a round ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HouseCollect<'info> {
    /// Anyone, once the round is final. Pays the epoch record's rent.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub house: Box<Account<'info, House>>,

    #[account(
        mut,
        address = house.round @ SoothCoreError::HouseIdle,
        constraint = ladder.load()?.shared_vault() && ladder.load()?.vault == house.vault @ SoothCoreError::LadderWrongAccount,
    )]
    pub ladder: AccountLoader<'info, Ladder>,

    #[account(
        mut,
        close = rent_payer,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), house.key().as_ref(), &[0u8]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    /// CHECK: paid the tranche's rent at start; bound to the house.
    #[account(mut, address = house.rent_payer @ SoothCoreError::LadderWrongAccount)]
    pub rent_payer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = cranker,
        space = HouseEpoch::SPACE,
        seeds = [HOUSE_EPOCH_SEED, house.key().as_ref(), &house.epoch.to_le_bytes()],
        bump,
    )]
    pub epoch: Box<Account<'info, HouseEpoch>>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct HouseCollected {
    pub house: Pubkey,
    pub ladder: Pubkey,
    pub epoch: u32,
    pub sent: u64,
    pub returned: u64,
    pub withdrawals_paid: u64,
    pub deposits_minted: u64,
    pub wiped: bool,
}

/// Book the house's tranche home from a finished round, by the round's own
/// rules, and process the queue at the price it left. The round and the
/// house share one vault, so nothing moves: what the round owes the house
/// leaves the round's books and joins the house's.
pub fn house_collect_handler(ctx: Context<HouseCollect>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    let (returned, fees, settled) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        let t = ctx.accounts.tranche.load()?;
        let (principal, fees) = take_tranche_owed(&mut l, &t)?;
        (principal.checked_add(fees).ok_or(SoothCoreError::MathOverflow)?, fees, l.status == STATUS_SETTLED)
    };

    let house_key = ctx.accounts.house.key();
    let h = &mut ctx.accounts.house;
    let sent = h.in_round;
    h.assets = h.assets.checked_add(returned).ok_or(SoothCoreError::MathOverflow)?;
    h.in_round = 0;
    h.round = Pubkey::default();
    // A void refunds its fees, so it says nothing about what the house earns.
    if settled {
        h.fee_ema = next_fee_ema(h.fee_ema, fees);
    }

    let e = &mut ctx.accounts.epoch;
    e.house = house_key;
    e.epoch = h.epoch;
    e.bump = ctx.bumps.epoch;
    // The price the queue is processed at, as `process_queue` reads it.
    let wipes = h.assets == 0 && h.total_shares > 0;
    e.assets = h.assets;
    e.shares = if wipes { 0 } else { h.total_shares };
    let deposits = h.pending_deposits;
    let (paid, _, wiped) = process_queue(h).ok_or(SoothCoreError::MathOverflow)?;
    e.wiped = wiped;
    e.generation = h.generation;
    h.epoch = h.epoch.checked_add(1).ok_or(SoothCoreError::MathOverflow)?;

    emit!(HouseCollected {
        house: house_key,
        ladder: ladder_key,
        epoch: e.epoch,
        sent,
        returned,
        withdrawals_paid: paid,
        deposits_minted: deposits,
        wiped,
    });
    Ok(())
}

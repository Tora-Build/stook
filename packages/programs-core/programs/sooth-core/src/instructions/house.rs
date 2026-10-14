//! The house: one standing pool per series that rolls from round to round
//! (`state::house`). Every instruction here is permissionless except a
//! depositor's own deposit, withdrawal, cancel and claim.
//!
//! A day of a house: the keeper settles yesterday's round, `house_collect`
//! brings the house's tranche home and processes the queue at the price the
//! round left, `house_join` puts everything into today's round before anyone
//! trades it, and the round opens. Deposits and withdrawals asked for during
//! the day wait for the next collect.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::SoothCoreError;
use crate::instructions::ladder::{join, one_token, take_tranche_owed};
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
    // A fee on every move in and out of a round would bleed the house a
    // little each day, and its books assume what it sends is what arrives.
    let fee = crate::token_guard::transfer_fee(&ctx.accounts.quote_mint.to_account_info().try_borrow_data()?, Clock::get()?.epoch);
    require!(fee.is_none(), SoothCoreError::HouseFeeMint);

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
/// round: queue the deposit for the price after the round.
pub fn house_deposit_handler(ctx: Context<HouseDeposit>, amount: u64) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require!(amount >= one_token(ctx.accounts.quote_mint.decimals)?, SoothCoreError::LadderSeedTooSmall);

    let before = ctx.accounts.vault.amount;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.lp_token.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.lp.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;
    ctx.accounts.vault.reload()?;
    require!(ctx.accounts.vault.amount.checked_sub(before) == Some(amount), SoothCoreError::HouseTransferShort);

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
/// a pause must not hold anyone's money.
pub fn house_withdraw_handler(ctx: Context<HouseLp>, shares: u128) -> Result<()> {
    let house_key = ctx.accounts.house.key();
    let paid = {
        let h = &mut ctx.accounts.house;
        let s = &mut ctx.accounts.stake;
        book(s, h, ctx.accounts.epoch.as_deref().map(|a| &**a))?;
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

// ── join a round ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HouseJoin<'info> {
    /// Anyone. Pays the tranche's rent and gets it back at collect.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub house: Box<Account<'info, House>>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    #[account(address = house.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault @ SoothCoreError::LadderWrongAccount)]
    pub ladder_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = house.vault)]
    pub house_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = cranker,
        space = LadderTranche::SPACE,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), house.key().as_ref(), &[0u8]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct HouseJoined {
    pub house: Pubkey,
    pub ladder: Pubkey,
    pub index: u32,
    pub amount: u64,
}

/// Put everything the house holds into a round of its series that nobody
/// has traded yet: one still seeding, or one just opened with no trade on
/// it. Its odds are then the opening prior, the same for whoever calls this
/// and whenever, so there is nothing to sandwich.
pub fn house_join_handler(ctx: Context<HouseJoin>) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    let now = Clock::get()?.unix_timestamp;
    let h = &ctx.accounts.house;
    require!(h.idle(), SoothCoreError::HouseBusy);
    let amount = h.assets;
    require!(amount >= one_token(ctx.accounts.quote_mint.decimals)?, SoothCoreError::HouseTooSmall);
    let index = {
        let l = ctx.accounts.ladder.load()?;
        require!(l.series == h.series && l.quote_mint == h.quote_mint, SoothCoreError::LadderWrongAccount);
        let untraded = l.status == STATUS_SEEDING || (l.status == STATUS_OPEN && l.curve_seq == 0);
        require!(untraded && now < l.locks_at, SoothCoreError::HouseNotJoinable);
        l.index
    };

    let series = h.series;
    let seeds: &[&[&[u8]]] = &[&[HOUSE_SEED, series.as_ref(), &[h.bump]]];
    let before = ctx.accounts.ladder_vault.amount;
    send(
        amount,
        &ctx.accounts.house_vault,
        &ctx.accounts.ladder_vault.to_account_info(),
        &ctx.accounts.house.to_account_info(),
        seeds,
        &ctx.accounts.quote_mint,
        &ctx.accounts.token_program,
    )?;
    ctx.accounts.ladder_vault.reload()?;
    require!(ctx.accounts.ladder_vault.amount.checked_sub(before) == Some(amount), SoothCoreError::HouseTransferShort);

    {
        let mut l = ctx.accounts.ladder.load_mut()?;
        let mut t = ctx.accounts.tranche.load_init()?;
        t.ladder = ctx.accounts.ladder.key();
        t.owner = ctx.accounts.house.key();
        t.index = 0;
        t.bump = ctx.bumps.tranche;
        join(&mut l, &mut t, amount)?;
        l.open_tranches = l.open_tranches.checked_add(1).ok_or(SoothCoreError::MathOverflow)?;
    }

    let h = &mut ctx.accounts.house;
    h.round = ctx.accounts.ladder.key();
    h.rent_payer = ctx.accounts.cranker.key();
    h.in_round = amount;
    h.assets = 0;
    h.last_index = index;
    emit!(HouseJoined { house: h.key(), ladder: h.round, index, amount });
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

    #[account(mut, address = house.round @ SoothCoreError::HouseIdle)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA vault authority of the round.
    #[account(seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()], bump = ladder.load()?.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(address = house.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault @ SoothCoreError::LadderWrongAccount)]
    pub ladder_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = house.vault)]
    pub house_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        close = rent_payer,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), house.key().as_ref(), &[0u8]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    /// CHECK: paid the tranche's rent at join; bound to the house.
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

    pub token_program: Interface<'info, TokenInterface>,
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

/// Bring the house's tranche home from a finished round, by the round's own
/// rules, and process the queue at the price it left.
pub fn house_collect_handler(ctx: Context<HouseCollect>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    let (owed, authority_bump) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        let t = ctx.accounts.tranche.load()?;
        let (principal, fees) = take_tranche_owed(&mut l, &t)?;
        (principal.checked_add(fees).ok_or(SoothCoreError::MathOverflow)?, l.authority_bump)
    };

    let before = ctx.accounts.house_vault.amount;
    let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
    send(
        owed,
        &ctx.accounts.ladder_vault,
        &ctx.accounts.house_vault.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
        seeds,
        &ctx.accounts.quote_mint,
        &ctx.accounts.token_program,
    )?;
    ctx.accounts.house_vault.reload()?;
    // Credit what arrived: should the coin start taking a fee, the house
    // wears it as a loss instead of believing in money it does not hold.
    let returned = ctx.accounts.house_vault.amount.checked_sub(before).ok_or(SoothCoreError::MathOverflow)?;

    let house_key = ctx.accounts.house.key();
    let h = &mut ctx.accounts.house;
    let sent = h.in_round;
    h.assets = h.assets.checked_add(returned).ok_or(SoothCoreError::MathOverflow)?;
    h.in_round = 0;
    h.round = Pubkey::default();

    let e = &mut ctx.accounts.epoch;
    e.house = house_key;
    e.epoch = h.epoch;
    e.bump = ctx.bumps.epoch;
    let (paid, minted, wiped) = {
        // The price the queue is processed at, as `process_queue` reads it.
        let wipes = h.assets == 0 && h.total_shares > 0;
        e.assets = h.assets;
        e.shares = if wipes { 0 } else { h.total_shares };
        let deposits = h.pending_deposits;
        let (paid, _minted, wiped) = process_queue(h).ok_or(SoothCoreError::MathOverflow)?;
        (paid, deposits, wiped)
    };
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
        deposits_minted: minted,
        wiped,
    });
    Ok(())
}

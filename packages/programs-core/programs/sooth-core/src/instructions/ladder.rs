//! Stook's market instructions: create a ladder, open it from the oracle, trade
//! a shape on it.
//!
//! Every token movement goes through `token_interface`, so a market quotes in
//! classic SPL (USDC) or Token-2022 (xStocks, STONK) through one code path. The
//! mints Token-2022 makes dangerous are refused at creation by `token_guard`.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SoothCoreError;
use crate::math::ladder::{apply_trade, band_width, bin_for, liquidity_for_deposit, prior, tranche_pnl, Shape};
use crate::math::{scalar_for, wad_to_amount_ceil, wad_to_amount_floor};
use crate::oracle::{check_settlement_instant, read_price_update, read_settlement_price, OraclePolicy};
use crate::state::ladder::*;
use crate::state::{require_not_paused, ProtocolConfig, Series, PROTOCOL_CONFIG_SEED};

/// The fee every round charges. Fixed rather than chosen, so a round's address
/// implies its terms and the first funder cannot poison a slot for everyone.
pub const LADDER_FEE_BPS: u16 = 100;

/// How long a round trades. A round started further ahead than this waits in
/// Seeding (deposits welcome) and opens `ROUND_SECS` before its close, so its
/// centre is read at an instant fixed by the round, not by whoever started it.
pub const ROUND_SECS: i64 = 24 * 60 * 60;

/// The gap between the last trade and the settlement read: a twenty-fourth of
/// the trading window, between two minutes and an hour. Nobody should trade
/// against a price they can already watch forming, and the last hour of a day
/// is mostly that.
pub const LOCK_GAP_MIN_SECS: i64 = 120;
pub const LOCK_GAP_MAX_SECS: i64 = 60 * 60;

/// The earliest a round opens after it is started: enough for the keeper to
/// post the price the grid centres on.
pub const OPEN_DELAY_SECS: i64 = 60;

/// A round must be started at least this long before it settles, and at
/// most this long.
pub const MIN_ROUND_SECS: i64 = 15 * 60;
pub const MAX_LEAD_SECS: i64 = 48 * 60 * 60;

/// Oracle freshness at open, and the widest confidence interval accepted.
pub const OPEN_MAX_AGE_SECS: i64 = 60;
pub const OPEN_MAX_CONF_BPS: u16 = 100;

/// Guardian-signature floor. Devnet posts are Partial without exception (3–5
/// signatures observed, zero Full); mainnet posts are Full. 255 is unreachable
/// by a Partial update, so on mainnet only Full passes.
#[cfg(feature = "mainnet")]
pub const ORACLE_MIN_SIGNATURES: u8 = 255;
#[cfg(not(feature = "mainnet"))]
pub const ORACLE_MIN_SIGNATURES: u8 = 3;

// ── pure helpers, tested below ───────────────────────────────────────────────

/// Fee on `amount`, never zero — a dust trade that paid no fee would be a free
/// way to churn state — and never more than the amount itself, so a dust
/// position can always be sold.
pub fn fee_on(amount: u64, fee_bps: u16) -> u64 {
    let raw = (amount as u128 * fee_bps as u128 + 9_999) / 10_000;
    (raw.max(1) as u64).min(amount)
}

/// 90% to the depositors, the remainder to the protocol (half of which pays
/// whoever settles). Nothing to the round's first funder: a bonus for being
/// first could be taken with a one-token seed on every round, so the first
/// funder is simply the first depositor. The protocol takes the remainder so
/// the parts always sum to the fee exactly. (The middle element is the
/// creator's share, kept at zero so the account layout does not change.)
pub fn split_fee(fee: u64) -> (u64, u64, u64) {
    let lp = (fee as u128 * 90 / 100) as u64;
    (lp, 0, fee - lp)
}

/// Cost basis released by selling `sold` of `held` shares. Rounds up, so the
/// basis left on the position — what a void would refund — never exceeds what
/// the holder actually still has at stake.
pub fn basis_released(net_paid: u64, sold: u64, held: u64) -> u64 {
    if held == 0 {
        return 0;
    }
    let num = net_paid as u128 * sold as u128;
    (((num + held as u128 - 1) / held as u128) as u64).min(net_paid)
}

fn math<T>(r: core::result::Result<T, crate::math::MathError>) -> Result<T> {
    r.map_err(|_| error!(SoothCoreError::MathOverflow))
}

/// A round's trading window, fixed by its close and the moment it was
/// started: `(opens_at, locks_at)`. Pure so the SDK and the calendar can
/// predict it.
pub fn round_times(now: i64, settles_at: i64) -> (i64, i64) {
    let opens_at = (now + OPEN_DELAY_SECS).max(settles_at - ROUND_SECS);
    let gap = ((settles_at - opens_at) / 24).clamp(LOCK_GAP_MIN_SECS, LOCK_GAP_MAX_SECS);
    (opens_at, settles_at - gap)
}

/// The least a tranche may deposit: one whole quote token. Below that `b`
/// rounds toward nothing and the deposit buys no depth worth accounting for.
fn one_token(decimals: u8) -> Result<u64> {
    10u64.checked_pow(decimals as u32).ok_or_else(|| error!(SoothCoreError::MathOverflow))
}

/// Move `net` quote tokens from `from` into the vault, on a mint that may
/// take a transfer fee. Sends the gross the mint's fee schedule implies, then
/// believes only what the vault says arrived: the pool's books are credited
/// with `net`, and a shortfall of any size reverts. A mint whose fee authority
/// raised the rate between the quote and the send fails here rather than
/// leaving the vault holding less than the curve believes.
fn pull<'info>(
    net: u64,
    from: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &mut InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let fee = crate::token_guard::transfer_fee(&mint.to_account_info().try_borrow_data()?, Clock::get()?.epoch);
    let gross = crate::token_guard::gross_for(net, fee).ok_or(SoothCoreError::UnsupportedMintExtension)?;
    let before = vault.amount;
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.clone(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority: authority.clone(),
            },
        ),
        gross,
        mint.decimals,
    )?;
    vault.reload()?;
    let arrived = vault.amount.checked_sub(before).ok_or(SoothCoreError::MathOverflow)?;
    require!(arrived >= net, SoothCoreError::LadderDepositShort);
    Ok(())
}

/// Price a deposit against the curve as it stands, and book it: the tranche
/// records what it joined at, the market gains its cash and its depth.
fn join(l: &mut Ladder, t: &mut LadderTranche, deposit: u64) -> Result<()> {
    let deposit_wad = (deposit as i128)
        .checked_mul(scalar_for(l.quote_decimals) as i128)
        .ok_or(SoothCoreError::MathOverflow)?;
    let (w, sum) = l.load_curve();
    let b = math(liquidity_for_deposit(&w, sum, deposit_wad))?;
    require!(b > 0, SoothCoreError::LadderSeedTooSmall);

    t.deposit = deposit;
    t.record_join(b, &w, sum, l.acc_fee());

    // Every trade divides by B; `wad_div` is exact only up to 2^96. A pool
    // deeper than that would refuse every trade until it settled.
    let deeper = l.b_wad().checked_add(b).ok_or(SoothCoreError::MathOverflow)?;
    require!(deeper as u128 <= crate::math::wad::MAX_WAD_DIVISOR, SoothCoreError::LadderTooDeep);
    l.set_b_wad(deeper);
    l.cash = l.cash.checked_add(deposit).ok_or(SoothCoreError::MathOverflow)?;
    l.deposit_total = l.deposit_total.checked_add(deposit).ok_or(SoothCoreError::MathOverflow)?;
    Ok(())
}

// ── create ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LadderCreateArgs {
    /// Which day (or period) of the series. The series turns it into the
    /// settlement second; everything else about the round follows from that
    /// and from the series' volatility.
    pub index: u32,
    /// The starter's deposit, in quote base units — the round's first liquidity.
    pub seed: u64,
    /// Who the round is presented as funded by. Attribution only.
    pub sponsor: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: LadderCreateArgs)]
pub struct LadderCreate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        constraint = series.active @ SoothCoreError::SeriesInactive,
        constraint = series.quote_mint == quote_mint.key() @ SoothCoreError::LadderWrongAccount,
    )]
    pub series: Box<Account<'info, Series>>,

    /// One round per day of a series. Whoever funds it first starts it;
    /// everyone after adds liquidity to the same round. Nothing about a
    /// round is its starter's choice: the fee is fixed, the times follow the
    /// series' close, the band width follows the series' volatility.
    #[account(
        init,
        payer = creator,
        space = Ladder::SPACE,
        seeds = [LADDER_SEED, series.key().as_ref(), &args.index.to_le_bytes()],
        bump,
    )]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA that owns the vault; holds no data and signs payouts.
    #[account(seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [LADDER_VAULT_SEED, ladder.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = creator,
        token::token_program = token_program,
    )]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The creator is the first LP, recorded the same way as any other.
    #[account(
        init,
        payer = creator,
        space = LadderTranche::SPACE,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), creator.key().as_ref(), &[0u8]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    /// Present only for a mint whose issuer holds powers over holders (every
    /// xStock). Its address is derived from the mint, so it cannot be an
    /// approval of something else.
    #[account(seeds = [MINT_APPROVAL_SEED, quote_mint.key().as_ref()], bump = mint_approval.bump)]
    pub mint_approval: Option<Box<Account<'info, MintApproval>>>,
}

#[event]
pub struct LadderCreated {
    pub ladder: Pubkey,
    pub creator: Pubkey,
    pub series: Pubkey,
    pub index: u32,
    pub step_bps: u16,
    pub opens_at: i64,
    pub locks_at: i64,
    pub settles_at: i64,
    pub seed: u64,
}

#[event]
pub struct LadderOpened {
    pub ladder: Pubkey,
    pub p0: i64,
    pub exponent: i32,
    pub b: u128,
}

#[event]
pub struct LadderVoided {
    pub ladder: Pubkey,
    pub refundable: u64,
}

pub fn create_handler(ctx: Context<LadderCreate>, args: LadderCreateArgs) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;

    // Can this protocol hold the quote token at all? Asked before anything is
    // written: a market around a transfer-fee mint fails at its first deposit.
    crate::token_guard::assert_mint_allowed(
        &ctx.accounts.quote_mint.to_account_info(),
        ctx.accounts.mint_approval.is_some(),
    )?;

    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.series.has_round(args.index), SoothCoreError::LadderBadTimes);
    let settles_at = ctx.accounts.series.close_of(args.index);
    // Not so soon that nobody can trade it; not so far ahead that the band
    // width, read from the volatility now, is stale by the time it opens.
    require!(
        now + MIN_ROUND_SECS <= settles_at && settles_at <= now + MAX_LEAD_SECS,
        SoothCoreError::LadderBadTimes
    );
    let (opens_at, locks_at) = round_times(now, settles_at);
    let (step_bps, var_bands) = math(band_width(ctx.accounts.series.var_wad, settles_at - opens_at))?;

    // At least one whole quote token. Below that `b` rounds to nothing and a
    // single small trade moves a bin from 2% to 80%.
    let decimals = ctx.accounts.quote_mint.decimals;
    require!(args.seed >= one_token(decimals)?, SoothCoreError::LadderSeedTooSmall);

    pull(
        args.seed,
        &ctx.accounts.creator_token.to_account_info(),
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.quote_mint,
        &mut ctx.accounts.vault,
        &ctx.accounts.token_program,
    )?;

    let mut l = ctx.accounts.ladder.load_init()?;
    l.opens_at = opens_at;
    l.locks_at = locks_at;
    l.settles_at = settles_at;
    l.step_bps = step_bps;
    l.index = args.index;
    l.series = ctx.accounts.series.key();
    l.fee_bps = LADDER_FEE_BPS;
    l.feed_id = ctx.accounts.series.feed_id;
    l.quote_mint = ctx.accounts.quote_mint.key();
    l.vault = ctx.accounts.vault.key();
    l.creator = ctx.accounts.creator.key();
    l.sponsor = if args.sponsor == Pubkey::default() {
        ctx.accounts.creator.key()
    } else {
        args.sponsor
    };
    let (w, sum) = math(prior(var_bands))?;
    l.store_curve(&w, sum);
    l.status = STATUS_SEEDING;
    l.settled_bin = NO_BIN;
    l.quote_decimals = decimals;
    l.bump = ctx.bumps.ladder;
    l.authority_bump = ctx.bumps.authority;
    l.vault_bump = ctx.bumps.vault;

    let mut t = ctx.accounts.tranche.load_init()?;
    t.ladder = ctx.accounts.ladder.key();
    t.owner = ctx.accounts.creator.key();
    t.index = 0;
    t.bump = ctx.bumps.tranche;
    join(&mut l, &mut t, args.seed)?;
    l.open_tranches = 1;

    emit!(LadderCreated {
        ladder: ctx.accounts.ladder.key(),
        creator: ctx.accounts.creator.key(),
        series: ctx.accounts.series.key(),
        index: args.index,
        step_bps,
        opens_at,
        locks_at,
        settles_at,
        seed: args.seed,
    });
    Ok(())
}

// ── open ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LadderOpen<'info> {
    /// Anyone may open a market once its time comes; nothing here is a choice.
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: a Pyth `PriceUpdateV2`. Ownership, layout, feed, freshness,
    /// signatures and confidence are all checked in `oracle`.
    pub price_update: UncheckedAccount<'info>,
}

pub fn open_handler(ctx: Context<LadderOpen>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut l = ctx.accounts.ladder.load_mut()?;

    require!(l.status == STATUS_SEEDING, SoothCoreError::LadderNotSeeding);
    require!(now >= l.opens_at && now < l.locks_at, SoothCoreError::LadderBadTimes);

    // The grid centres on the price NOW, not at creation: a market that sat in
    // Seeding through a 3% move must not open with a centre the first trader
    // can harvest.
    let price = read_settlement_price(
        &ctx.accounts.price_update.to_account_info(),
        &OraclePolicy {
            feed_id: l.feed_id,
            max_age_secs: OPEN_MAX_AGE_SECS,
            min_signatures: ORACLE_MIN_SIGNATURES,
            max_conf_bps: OPEN_MAX_CONF_BPS,
        },
        now,
    )?;
    l.p0 = price.price;
    l.p0_expo = price.exponent;

    // Depth was bought by the tranches that joined during Seeding, each at
    // b = 0.9999 · deposit / ln(1/p_min) under the prior — the most its
    // deposit fully covers.
    require!(l.b_wad() > 0, SoothCoreError::LadderSeedTooSmall);

    l.status = STATUS_OPEN;
    emit!(LadderOpened { ladder: ctx.accounts.ladder.key(), p0: l.p0, exponent: l.p0_expo, b: l.b_wad() as u128 });
    Ok(())
}

// ── trade ────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct LadderTradeArgs {
    pub lo: i16,
    pub hi: i16,
    pub h: u8,
    /// Shares in quote base units. Positive buys, negative sells.
    pub shares: i64,
    /// Buying: the most the trader will pay, fee included.
    /// Selling: the least they will accept, fee deducted.
    pub limit: u64,
}

#[derive(Accounts)]
#[instruction(args: LadderTradeArgs)]
pub struct LadderTrade<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA vault authority, re-derived from the ladder key.
    #[account(
        seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()],
        bump = ladder.load()?.authority_bump,
    )]
    pub authority: UncheckedAccount<'info>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        space = LadderPosition::SPACE,
        seeds = [
            LADDER_POSITION_SEED,
            ladder.key().as_ref(),
            user.key().as_ref(),
            &args.lo.to_le_bytes(),
            &args.hi.to_le_bytes(),
            &[args.h],
        ],
        bump,
    )]
    pub position: Box<Account<'info, LadderPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct LadderTraded {
    pub ladder: Pubkey,
    pub user: Pubkey,
    pub lo: i16,
    pub hi: i16,
    pub h: u8,
    pub shares: i64,
    /// Quote base units that moved between the trader and the pool, before fee.
    pub amount: u64,
    pub fee: u64,
}

pub fn trade_handler(ctx: Context<LadderTrade>, args: LadderTradeArgs) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    require!(args.shares != 0, SoothCoreError::LadderZeroTrade);

    let now = Clock::get()?.unix_timestamp;
    let shape = Shape { lo: args.lo, hi: args.hi, h: args.h };
    math(shape.validate())?;

    let ladder_key = ctx.accounts.ladder.key();
    let buying = args.shares > 0;
    let size = args.shares.unsigned_abs();

    // First touch of this shape by this wallet.
    let pos = &mut ctx.accounts.position;
    if pos.owner == Pubkey::default() {
        let mut l = ctx.accounts.ladder.load_mut()?;
        l.open_positions = l.open_positions.checked_add(1).ok_or(SoothCoreError::MathOverflow)?;
        drop(l);
        pos.ladder = ladder_key;
        pos.owner = ctx.accounts.user.key();
        pos.lo = args.lo;
        pos.hi = args.hi;
        pos.h = args.h;
        pos.bump = ctx.bumps.position;
    }
    if !buying {
        require!(pos.shares >= size, SoothCoreError::LadderInsufficientShares);
    }

    // ── price it, and update the pool's books ────────────────────────────────
    let (amount, fee, decimals, authority_bump) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        require!(l.tradeable(now), SoothCoreError::LadderNotOpen);

        let decimals = l.quote_decimals;
        let delta_wad = (args.shares as i128)
            .checked_mul(scalar_for(decimals) as i128)
            .ok_or(SoothCoreError::MathOverflow)?;

        let (mut w, mut sum) = l.load_curve();
        let cost_wad = math(apply_trade(&mut w, &mut sum, l.b_wad(), shape, delta_wad))?;
        l.store_curve(&w, sum);

        // One base unit against the trader on top of ceil/floor. The scoring
        // rule is exact in reals; this keeps a round trip from ever paying in
        // integers — the audits measured −2 to −3 units per round trip with
        // this discipline and never a positive one.
        let (amount, fee) = if buying {
            require!(cost_wad > 0, SoothCoreError::MathOverflow);
            let pay = math(wad_to_amount_ceil(cost_wad as u128, decimals))?
                .checked_add(1)
                .ok_or(SoothCoreError::MathOverflow)?;
            (pay, fee_on(pay, l.fee_bps))
        } else {
            require!(cost_wad < 0, SoothCoreError::MathOverflow);
            let got = math(wad_to_amount_floor((-cost_wad) as u128, decimals))?.saturating_sub(1);
            (got, fee_on(got, l.fee_bps))
        };

        // The payout table moves with the position, per bin, by level.
        for i in shape.bins() {
            let owed = size
                .checked_mul(shape.level(i) as u64)
                .ok_or(SoothCoreError::MathOverflow)?;
            l.payout[i] = if buying {
                l.payout[i].checked_add(owed)
            } else {
                l.payout[i].checked_sub(owed)
            }
            .ok_or(SoothCoreError::MathOverflow)?;
        }

        l.cash = if buying { l.cash.checked_add(amount) } else { l.cash.checked_sub(amount) }
            .ok_or(SoothCoreError::MathOverflow)?;

        l.curve_seq = l.curve_seq.wrapping_add(1);

        let (to_lp, to_creator, to_protocol) = split_fee(fee);
        let b_units = Ladder::b_units(l.b_wad(), decimals);
        l.accrue_lp_fee(to_lp, b_units);
        l.fees_lp = l.fees_lp.checked_add(to_lp).ok_or(SoothCoreError::MathOverflow)?;
        l.fees_creator = l.fees_creator.checked_add(to_creator).ok_or(SoothCoreError::MathOverflow)?;
        l.fees_protocol = l.fees_protocol.checked_add(to_protocol).ok_or(SoothCoreError::MathOverflow)?;

        // Solvency as a comparison, not a belief. The LMSR bound says this
        // holds; the check is what makes a rounding or accounting bug revert a
        // trade instead of stranding a winner.
        require!(l.cash >= l.max_payout(), SoothCoreError::LadderInsolvent);

        (amount, fee, decimals, l.authority_bump)
    };

    // ── move the money and the position ──────────────────────────────────────
    let pos = &mut ctx.accounts.position;
    if buying {
        let total = amount.checked_add(fee).ok_or(SoothCoreError::MathOverflow)?;
        require!(total <= args.limit, SoothCoreError::SlippageExceeded);

        pull(
            total,
            &ctx.accounts.user_token.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.quote_mint,
            &mut ctx.accounts.vault,
            &ctx.accounts.token_program,
        )?;
        pos.shares = pos.shares.checked_add(size).ok_or(SoothCoreError::MathOverflow)?;
        pos.net_paid = pos.net_paid.checked_add(total).ok_or(SoothCoreError::MathOverflow)?;
        let mut l = ctx.accounts.ladder.load_mut()?;
        l.basis_total = l.basis_total.checked_add(total).ok_or(SoothCoreError::MathOverflow)?;
    } else {
        let out = amount - fee; // fee_on never exceeds amount
        require!(out >= args.limit, SoothCoreError::SlippageExceeded);

        let released = basis_released(pos.net_paid, size, pos.shares);
        pos.net_paid -= released;
        pos.shares -= size;
        {
            let mut l = ctx.accounts.ladder.load_mut()?;
            l.basis_total = l.basis_total.checked_sub(released).ok_or(SoothCoreError::MathOverflow)?;
        }

        if out > 0 {
            let seeds: &[&[&[u8]]] =
                &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.quote_mint.to_account_info(),
                        to: ctx.accounts.user_token.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                    seeds,
                ),
                out,
                decimals,
            )?;
        }
    }

    emit!(LadderTraded {
        ladder: ladder_key,
        user: ctx.accounts.user.key(),
        lo: args.lo,
        hi: args.hi,
        h: args.h,
        shares: args.shares,
        amount,
        fee,
    });
    Ok(())
}

// ── LP join ──────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct LadderLpJoinArgs {
    /// Which of this wallet's tranches this is. A wallet that joins twice joins
    /// at two sets of prices, so they are two tranches.
    pub index: u8,
    pub deposit: u64,
    /// `Ladder::curve_seq` as the LP read it. The join lands at exactly those
    /// prices or not at all.
    pub expected_seq: u64,
}

#[derive(Accounts)]
#[instruction(args: LadderLpJoinArgs)]
pub struct LadderLpJoin<'info> {
    #[account(mut)]
    pub lp: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = lp,
        token::token_program = token_program,
    )]
    pub lp_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = lp,
        space = LadderTranche::SPACE,
        seeds = [LADDER_TRANCHE_SEED, ladder.key().as_ref(), lp.key().as_ref(), &[args.index]],
        bump,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct LadderLpJoined {
    pub ladder: Pubkey,
    pub owner: Pubkey,
    pub index: u8,
    pub deposit: u64,
    /// Liquidity bought, WAD. Less per token the longer the longest shot is.
    pub b: u128,
    pub curve_seq: u64,
}

/// Add liquidity — while the market is Seeding or Open, by anyone.
///
/// The deposit buys `b = 0.9999 · deposit / ln(1/p_min)` at the prices of this
/// moment: the most depth whose worst case the deposit covers alone. Late
/// liquidity therefore never leans on earlier LPs, and earlier LPs' results are
/// untouched by it — only future flow and future fees are shared.
pub fn lp_join_handler(ctx: Context<LadderLpJoin>, args: LadderLpJoinArgs) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;
    let now = Clock::get()?.unix_timestamp;

    let (b, seq) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        require!(
            (l.status == STATUS_SEEDING || l.status == STATUS_OPEN) && now < l.locks_at,
            SoothCoreError::LadderNotJoinable
        );
        require!(l.curve_seq == args.expected_seq, SoothCoreError::LadderCurveMoved);
        require!(args.deposit >= one_token(l.quote_decimals)?, SoothCoreError::LadderSeedTooSmall);

        let mut t = ctx.accounts.tranche.load_init()?;
        t.ladder = ctx.accounts.ladder.key();
        t.owner = ctx.accounts.lp.key();
        t.index = args.index;
        t.bump = ctx.bumps.tranche;
        join(&mut l, &mut t, args.deposit)?;
        l.open_tranches = l.open_tranches.checked_add(1).ok_or(SoothCoreError::MathOverflow)?;
        (t.b_wad(), l.curve_seq)
    };

    pull(
        args.deposit,
        &ctx.accounts.lp_token.to_account_info(),
        &ctx.accounts.lp.to_account_info(),
        &ctx.accounts.quote_mint,
        &mut ctx.accounts.vault,
        &ctx.accounts.token_program,
    )?;

    emit!(LadderLpJoined {
        ladder: ctx.accounts.ladder.key(),
        owner: ctx.accounts.lp.key(),
        index: args.index,
        deposit: args.deposit,
        b: b as u128,
        curve_seq: seq,
    });
    Ok(())
}

// ── settle ───────────────────────────────────────────────────────────────────

/// Share of the protocol's fee take paid to whoever settles. Nobody is
/// obliged to run a keeper, so the market pays for its own ending: the
/// settler gets half the protocol's cut, the treasury the rest. A void pays
/// nothing — a losing trader should never prefer voiding to settling.
pub const SETTLE_BOUNTY_NUM: u64 = 1;
pub const SETTLE_BOUNTY_DEN: u64 = 2;

pub fn settle_bounty(fees_protocol: u64) -> u64 {
    fees_protocol / SETTLE_BOUNTY_DEN * SETTLE_BOUNTY_NUM
}

#[derive(Accounts)]
pub struct LadderSettle<'info> {
    /// Anyone. Which update settles a market is fixed by the rule in
    /// `oracle::check_settlement_instant`, not by who posts it.
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: a Pyth `PriceUpdateV2`; verified in `oracle`.
    pub price_update: UncheckedAccount<'info>,

    /// The round's series: it learns the anchor's volatility from this price.
    #[account(mut, address = ladder.load()?.series @ SoothCoreError::LadderWrongAccount)]
    pub series: Box<Account<'info, Series>>,

    /// CHECK: PDA vault authority.
    #[account(seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()], bump = ladder.load()?.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Where the bounty goes.
    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = cranker,
        token::token_program = token_program,
    )]
    pub cranker_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct LadderSettled {
    pub ladder: Pubkey,
    pub price: i64,
    pub exponent: i32,
    pub bin: u8,
    pub owed_to_winners: u64,
    pub lp_pool: u64,
    pub bounty: u64,
}

pub fn settle_handler(ctx: Context<LadderSettle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let ladder_key = ctx.accounts.ladder.key();
    let (bounty, decimals, authority_bump) = {
    let mut l = ctx.accounts.ladder.load_mut()?;
    require!(
        l.status == STATUS_OPEN && now >= l.settles_at,
        SoothCoreError::LadderNotSettleable
    );

    let p = read_price_update(&ctx.accounts.price_update.to_account_info())?;
    check_settlement_instant(
        &p,
        &l.feed_id,
        ORACLE_MIN_SIGNATURES,
        l.settles_at,
        SETTLE_MAX_GAP_SECS,
        l.step_bps,
    )?;
    // The grid is a ratio to p0, so both must be on the same scale.
    require!(p.exponent == l.p0_expo, SoothCoreError::OracleExponentChanged);

    let bin = math(bin_for(p.price, l.p0, l.step_bps))?;
    let owed = l.payout[bin as usize];
    // Solvency was enforced on every trade; this is the same comparison at the
    // moment it becomes a debt.
    require!(l.cash >= owed, SoothCoreError::LadderInsolvent);

    // Winners' money stays reserved in `cash`. The rest is what tranches draw
    // their principal from; LP fees stay in `fees_lp` and are drawn separately.
    l.lp_pool = l.cash - owed;
    l.cash = owed;
    l.settled_bin = bin;
    l.status = STATUS_SETTLED;

    let bounty = settle_bounty(l.fees_protocol);
    l.fees_protocol -= bounty;

    // The price at this round's close, against the last close the series
    // saw: tomorrow's band width is learned from it.
    // A settlement must never fail because the series could not learn from
    // it: an observation that errors is skipped, and the round settles.
    let _ = ctx.accounts.series.observe(p.price, p.exponent, l.settles_at);

    emit!(LadderSettled {
        ladder: ladder_key,
        price: p.price,
        exponent: p.exponent,
        bin,
        owed_to_winners: owed,
        lp_pool: l.lp_pool,
        bounty,
    });
    (bounty, l.quote_decimals, l.authority_bump)
    };

    if bounty > 0 {
        let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.cranker_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            bounty,
            decimals,
        )?;
    }
    Ok(())
}

// ── void ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LadderVoid<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,
}

/// Give up on a market that cannot finish: one that never opened before its
/// lock, or one whose settlement price never arrived within the grace period.
/// Not a judgement call and not a privilege — both conditions are clock reads.
pub fn void_handler(ctx: Context<LadderVoid>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut l = ctx.accounts.ladder.load_mut()?;

    let never_opened = l.status == STATUS_SEEDING && now >= l.locks_at;
    let never_settled = l.status == STATUS_OPEN && now >= l.settles_at + VOID_GRACE_SECS;
    require!(never_opened || never_settled, SoothCoreError::LadderNotVoidable);

    // Fees go back into the pot: a void refunds what people PAID, fee included,
    // so nobody keeps a fee for a market that did not happen. Depositors are
    // made whole first; open positions share what is left (see `Ladder`).
    let vault = l
        .cash
        .checked_add(l.fees_lp)
        .and_then(|v| v.checked_add(l.fees_creator))
        .and_then(|v| v.checked_add(l.fees_protocol))
        .ok_or(SoothCoreError::MathOverflow)?;
    let (lp_pot, trader_pot) = void_pots(vault, l.deposit_total, l.basis_total);
    l.void_lp_pot = lp_pot;
    l.void_trader_pot = trader_pot;
    l.fees_lp = 0;
    l.fees_creator = 0;
    l.fees_protocol = 0;
    l.status = STATUS_VOID;
    emit!(LadderVoided { ladder: ctx.accounts.ladder.key(), refundable: vault });
    Ok(())
}

/// Split a voided market's vault: depositors up to what they put in, open
/// positions the remainder. The remainder is short of what traders paid by
/// exactly the gains sellers realised before the void (and long by their
/// losses), so those gains are paid by the traders who stayed, not the house.
pub fn void_pots(vault: u64, deposit_total: u64, basis_total: u64) -> (u64, u64) {
    // Nobody still holds a position: everything left is the depositors'.
    let lp = if basis_total == 0 { vault } else { vault.min(deposit_total) };
    (lp, vault - lp)
}

/// One claim's cut of a pot, pro rata and floored: `claim × pot / claims`.
/// Floors make the result independent of claim order and never overdraw.
pub fn void_share(claim: u64, pot: u64, claims: u64) -> u64 {
    if claims == 0 {
        return 0;
    }
    (claim as u128 * pot as u128 / claims as u128) as u64
}

// ── redeem ───────────────────────────────────────────────────────────────────

/// What a position is owed once its market is final.
///
/// Settled: `shares × level(settled_bin)` — the tent's taper, read at one bin.
/// Void: cost basis, as a share of the traders' pot.
pub fn redemption(
    status: u8,
    settled_bin: u8,
    shape: Shape,
    shares: u64,
    net_paid: u64,
    trader_pot: u64,
    basis_total: u64,
) -> Option<u64> {
    match status {
        STATUS_SETTLED => shares.checked_mul(shape.level(settled_bin as usize) as u64),
        STATUS_VOID => Some(void_share(net_paid, trader_pot, basis_total)),
        _ => None,
    }
}

#[derive(Accounts)]
pub struct LadderRedeem<'info> {
    /// The owner, or after `CLAIM_GRACE_SECS` anyone: the payout still goes
    /// only to the owner's token account and the rent only to the owner.
    pub caller: Signer<'info>,

    /// CHECK: bound to the position's (or tranche's) owner below; receives
    /// the rent and, through `owner_token`, the payout.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA vault authority.
    #[account(
        seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()],
        bump = ladder.load()?.authority_bump,
    )]
    pub authority: UncheckedAccount<'info>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Closed on redemption whether it pays or not, so a losing position still
    /// returns its rent.
    #[account(
        mut,
        close = owner,
        constraint = position.owner == owner.key() @ SoothCoreError::LadderWrongAccount,
        constraint = position.ladder == ladder.key() @ SoothCoreError::LadderWrongAccount,
    )]
    pub position: Box<Account<'info, LadderPosition>>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// How long after a round's close its positions and deposits wait for their
/// owners. After that anyone may pay them out, to the owner, so one absent
/// winner cannot keep a finished round open forever.
pub const CLAIM_GRACE_SECS: i64 = 30 * 24 * 60 * 60;

/// The owner may always collect; anyone else only after the grace period.
fn may_collect(caller: &Pubkey, owner: &Pubkey, settles_at: i64) -> Result<()> {
    if caller == owner {
        return Ok(());
    }
    require!(Clock::get()?.unix_timestamp >= settles_at + CLAIM_GRACE_SECS, SoothCoreError::LadderNotYours);
    Ok(())
}

pub fn redeem_handler(ctx: Context<LadderRedeem>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    may_collect(&ctx.accounts.caller.key(), &ctx.accounts.owner.key(), ctx.accounts.ladder.load()?.settles_at)?;
    let pos = &ctx.accounts.position;
    let shape = Shape { lo: pos.lo, hi: pos.hi, h: pos.h };

    let (owed, decimals, authority_bump) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        let owed = redemption(
            l.status, l.settled_bin, shape, pos.shares, pos.net_paid, l.void_trader_pot, l.basis_total,
        )
        .ok_or(SoothCoreError::LadderNotFinal)?;

        if l.status == STATUS_SETTLED {
            let bin = l.settled_bin as usize;
            l.payout[bin] = l.payout[bin].checked_sub(owed).ok_or(SoothCoreError::MathOverflow)?;
            l.cash = l.cash.checked_sub(owed).ok_or(SoothCoreError::MathOverflow)?;
        }
        l.open_positions = l.open_positions.saturating_sub(1);
        (owed, l.quote_decimals, l.authority_bump)
    };

    if owed > 0 {
        let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            owed,
            decimals,
        )?;
    }
    Ok(())
}

// ── LP claim ─────────────────────────────────────────────────────────────────

/// A tranche's principal after settlement: its deposit plus its P&L at the
/// settled bin, rounded against the tranche. Never negative — `b` was sized so
/// the worst bin costs less than the deposit.
pub fn tranche_principal(deposit: u64, pnl_wad: i128, decimals: u8) -> Option<u64> {
    if pnl_wad >= 0 {
        let gain = wad_to_amount_floor(pnl_wad as u128, decimals).ok()?;
        deposit.checked_add(gain)
    } else {
        let loss = wad_to_amount_ceil(pnl_wad.unsigned_abs(), decimals).ok()?;
        Some(deposit.saturating_sub(loss))
    }
}

/// LP fees a tranche earned: the growth of the per-unit-`b` accumulator since
/// it joined, times its `b`. Floors.
pub fn tranche_fees(b_units: u128, acc_now: u128, acc_at_join: u128) -> Option<u64> {
    let grown = acc_now.checked_sub(acc_at_join)?;
    u64::try_from(b_units.checked_mul(grown)? / FEE_ACC_SCALE).ok()
}

/// A tranche's share of what a void leaves once every trader is refunded, pro
/// rata to deposit. Floors, so the dust stays in the vault rather than the last
/// LP finding it a unit short.
pub fn lp_share(pool: u64, deposit: u64, deposit_total: u64) -> u64 {
    if deposit_total == 0 {
        return 0;
    }
    (pool as u128 * deposit as u128 / deposit_total as u128) as u64
}

#[derive(Accounts)]
pub struct LadderClaimLp<'info> {
    /// The owner, or after `CLAIM_GRACE_SECS` anyone: the payout still goes
    /// only to the owner's token account and the rent only to the owner.
    pub caller: Signer<'info>,

    /// CHECK: bound to the position's (or tranche's) owner below; receives
    /// the rent and, through `owner_token`, the payout.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA vault authority.
    #[account(
        seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()],
        bump = ladder.load()?.authority_bump,
    )]
    pub authority: UncheckedAccount<'info>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        close = owner,
        constraint = tranche.load()?.owner == owner.key() @ SoothCoreError::LadderWrongAccount,
        constraint = tranche.load()?.ladder == ladder.key() @ SoothCoreError::LadderWrongAccount,
    )]
    pub tranche: AccountLoader<'info, LadderTranche>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct LadderLpClaimed {
    pub ladder: Pubkey,
    pub owner: Pubkey,
    pub index: u8,
    pub deposit: u64,
    pub principal: u64,
    pub fees: u64,
}

pub fn claim_lp_handler(ctx: Context<LadderClaimLp>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    may_collect(&ctx.accounts.caller.key(), &ctx.accounts.owner.key(), ctx.accounts.ladder.load()?.settles_at)?;
    let (principal, fees, decimals, authority_bump) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        let t = ctx.accounts.tranche.load()?;
        let (principal, fees) = match l.status {
            STATUS_SETTLED => {
                let k = l.settled_bin as usize;
                let pnl = math(tranche_pnl(
                    t.b_wad(),
                    t.join_weight(k),
                    t.join_sum(),
                    l.weight(k),
                    l.sum_wad(),
                ))?;
                // Both are drawn from pots that only shrink, so rounding that
                // sums a unit high is absorbed here, never by the vault.
                let principal = tranche_principal(t.deposit, pnl, l.quote_decimals)
                    .ok_or(SoothCoreError::MathOverflow)?
                    .min(l.lp_pool);
                let fees = tranche_fees(
                    Ladder::b_units(t.b_wad(), l.quote_decimals),
                    l.acc_fee(),
                    t.fee_snap(),
                )
                .ok_or(SoothCoreError::MathOverflow)?
                .min(l.fees_lp);
                l.lp_pool -= principal;
                l.fees_lp -= fees;
                (principal, fees)
            }
            // In a void a deposit comes back from the depositors' pot, which
            // is whole unless the vault itself is short of every deposit.
            // Fees were folded back into the pot.
            STATUS_VOID => (void_share(t.deposit, l.void_lp_pot, l.deposit_total), 0),
            _ => return err!(SoothCoreError::LadderNotFinal),
        };
        l.open_tranches = l.open_tranches.saturating_sub(1);
        emit!(LadderLpClaimed {
            ladder: ladder_key,
            owner: t.owner,
            index: t.index,
            deposit: t.deposit,
            principal,
            fees,
        });
        (principal, fees, l.quote_decimals, l.authority_bump)
    };
    let owed = principal.checked_add(fees).ok_or(SoothCoreError::MathOverflow)?;

    if owed > 0 {
        let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            owed,
            decimals,
        )?;
    }
    Ok(())
}

// ── clearing up ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LadderSweep<'info> {
    /// Anyone: the rent goes to the position's owner, and only a position
    /// owed nothing can be swept.
    pub cranker: Signer<'info>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    #[account(
        mut,
        close = owner,
        constraint = position.ladder == ladder.key() @ SoothCoreError::LadderWrongAccount,
    )]
    pub position: Box<Account<'info, LadderPosition>>,

    /// CHECK: receives the position's rent; bound to the position's owner.
    #[account(mut, address = position.owner @ SoothCoreError::LadderWrongAccount)]
    pub owner: UncheckedAccount<'info>,
}

/// Close a finished round's position that is owed nothing (a line that
/// missed, or one sold down to zero), returning its rent to its owner.
/// Winners collect their own; this only clears what nobody would bother to,
/// so the round itself can be closed.
pub fn sweep_handler(ctx: Context<LadderSweep>) -> Result<()> {
    let pos = &ctx.accounts.position;
    let mut l = ctx.accounts.ladder.load_mut()?;
    let owed = redemption(
        l.status,
        l.settled_bin,
        Shape { lo: pos.lo, hi: pos.hi, h: pos.h },
        pos.shares,
        pos.net_paid,
        l.void_trader_pot,
        l.basis_total,
    )
    .ok_or(SoothCoreError::LadderNotFinal)?;
    require!(owed == 0, SoothCoreError::LadderPositionOwed);
    l.open_positions = l.open_positions.saturating_sub(1);
    Ok(())
}

#[derive(Accounts)]
pub struct LadderClose<'info> {
    /// Anyone, once there is nothing left to pay.
    pub cranker: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut, close = creator)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: paid the round's and the vault's rent back; bound to the ladder.
    #[account(mut, address = ladder.load()?.creator @ SoothCoreError::LadderWrongAccount)]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: PDA vault authority.
    #[account(seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()], bump = ladder.load()?.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(mut, address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Where the rounding dust goes.
    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = config.treasury,
        token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct LadderClosed {
    pub ladder: Pubkey,
    pub dust: u64,
}

/// Close a finished round: every position redeemed or swept, every deposit
/// claimed, the fee shares collected. What is left in the vault is rounding
/// dust (a few base units); it goes to the treasury, and the round's and the
/// vault's rent go back to whoever funded the round.
pub fn close_handler(ctx: Context<LadderClose>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    let authority_bump = {
        let l = ctx.accounts.ladder.load()?;
        require!(l.status == STATUS_SETTLED || l.status == STATUS_VOID, SoothCoreError::LadderNotFinal);
        // Not before the day's close: a round voided early must keep its
        // address until then, or the same day could be started again on
        // different terms.
        require!(Clock::get()?.unix_timestamp >= l.settles_at, SoothCoreError::LadderNotClosable);
        require!(
            l.open_positions == 0 && l.open_tranches == 0 && l.fees_creator == 0 && l.fees_protocol == 0,
            SoothCoreError::LadderNotClosable
        );
        l.authority_bump
    };
    let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
    let dust = ctx.accounts.vault.amount;
    if dust > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.treasury_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            dust,
            ctx.accounts.quote_mint.decimals,
        )?;
    }
    // Token-2022 keeps each transfer's fee in the receiving account until
    // someone harvests it to the mint, and refuses to close an account that
    // still holds some. Harvesting is permissionless.
    let withheld = crate::token_guard::withheld_in_account(&ctx.accounts.vault.to_account_info().try_borrow_data()?);
    if withheld > 0 {
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(ctx.accounts.quote_mint.key(), false),
                anchor_lang::solana_program::instruction::AccountMeta::new(ctx.accounts.vault.key(), false),
            ],
            // TransferFeeExtension (26) · HarvestWithheldTokensToMint (4)
            data: vec![26, 4],
        };
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.quote_mint.to_account_info(), ctx.accounts.vault.to_account_info()],
        )?;
    }
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
        seeds,
    ))?;
    emit!(LadderClosed { ladder: ladder_key, dust });
    Ok(())
}

// ── fees ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LadderCollectFees<'info> {
    /// Anyone: the destinations are fixed by the market and the protocol.
    pub cranker: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(mut)]
    pub ladder: AccountLoader<'info, Ladder>,

    /// CHECK: PDA vault authority.
    #[account(
        seeds = [LADDER_AUTHORITY_SEED, ladder.key().as_ref()],
        bump = ladder.load()?.authority_bump,
    )]
    pub authority: UncheckedAccount<'info>,

    #[account(address = ladder.load()?.quote_mint)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, address = ladder.load()?.vault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = ladder.load()?.creator,
        token::token_program = token_program,
    )]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = quote_mint,
        token::authority = config.treasury,
        token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Sweep the creator's and protocol's fee shares out of a settled market.
/// Only a settled one: while the market runs, `fees_protocol` is what funds
/// the settler's bounty and a void folds every fee back into the refund pot,
/// so an early sweep would either starve the ending or short the refunds.
pub fn collect_fees_handler(ctx: Context<LadderCollectFees>) -> Result<()> {
    let ladder_key = ctx.accounts.ladder.key();
    let (to_creator, to_protocol, decimals, authority_bump) = {
        let mut l = ctx.accounts.ladder.load_mut()?;
        require!(l.status == STATUS_SETTLED, SoothCoreError::LadderNotFinal);
        let out = (l.fees_creator, l.fees_protocol, l.quote_decimals, l.authority_bump);
        l.fees_creator = 0;
        l.fees_protocol = 0;
        out
    };
    let seeds: &[&[&[u8]]] = &[&[LADDER_AUTHORITY_SEED, ladder_key.as_ref(), &[authority_bump]]];
    for (amount, to) in [
        (to_creator, ctx.accounts.creator_token.to_account_info()),
        (to_protocol, ctx.accounts.treasury_token.to_account_info()),
    ] {
        if amount == 0 {
            continue;
        }
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to,
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            amount,
            decimals,
        )?;
    }
    Ok(())
}

// ── mint approval ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ApproveQuoteMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = MintApproval::SPACE,
        seeds = [MINT_APPROVAL_SEED, mint.key().as_ref()],
        bump,
    )]
    pub approval: Box<Account<'info, MintApproval>>,

    pub system_program: Program<'info, System>,
}

/// Accept a mint's issuer. This says "we know this issuer can claw back and
/// pause, and we quote markets in their token anyway" — it does not lower the
/// bar for anything `token_guard` refuses, and approving a refused mint fails
/// here rather than leaving a useless record.
pub fn approve_quote_mint_handler(ctx: Context<ApproveQuoteMint>) -> Result<()> {
    crate::token_guard::assert_mint_allowed(&ctx.accounts.mint.to_account_info(), true)?;
    let a = &mut ctx.accounts.approval;
    a.mint = ctx.accounts.mint.key();
    a.approved_by = ctx.accounts.authority.key();
    a.approved_at = Clock::get()?.unix_timestamp;
    a.bump = ctx.bumps.approval;
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeQuoteMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SoothCoreError::Unauthorized,
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        close = authority,
        seeds = [MINT_APPROVAL_SEED, approval.mint.as_ref()],
        bump = approval.bump,
    )]
    pub approval: Box<Account<'info, MintApproval>>,
}

/// Stops NEW markets in this mint. Markets that exist run to their end: their
/// traders entered under the approval, and stranding them would be worse than
/// whatever prompted the revocation.
pub fn revoke_quote_mint_handler(_ctx: Context<RevokeQuoteMint>) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fee_is_never_zero_and_never_more_than_the_amount() {
        assert_eq!(fee_on(10_000, 100), 100);
        assert_eq!(fee_on(10_001, 100), 101, "rounds up");
        assert_eq!(fee_on(5, 100), 1, "dust still pays");
        assert_eq!(fee_on(1, 100), 1);
        assert_eq!(fee_on(0, 100), 0, "so a dust position can always be sold");
    }

    #[test]
    fn the_fee_split_sums_to_the_fee() {
        for fee in [0u64, 1, 2, 3, 9, 10, 11, 99, 100, 1_234_567, u64::MAX / 100] {
            let (lp, creator, protocol) = split_fee(fee);
            assert_eq!(lp + creator + protocol, fee, "fee {fee}");
        }
        assert_eq!(split_fee(100), (90, 0, 10));
    }

    #[test]
    fn selling_releases_basis_in_proportion_and_never_more_than_there_is() {
        assert_eq!(basis_released(1_000, 50, 100), 500);
        assert_eq!(basis_released(1_000, 100, 100), 1_000, "a full exit releases everything");
        assert_eq!(basis_released(1_001, 1, 3), 334, "rounds up");
        assert_eq!(basis_released(10, 100, 100), 10);
        assert_eq!(basis_released(10, 1, 0), 0);
        // Selling in pieces never leaves more basis than selling at once would.
        let mut basis = 1_000u64;
        let mut held = 7u64;
        for _ in 0..7 {
            basis -= basis_released(basis, 1, held);
            held -= 1;
        }
        assert_eq!(basis, 0);
    }

    #[test]
    fn a_settled_tent_pays_by_distance_and_a_miss_pays_nothing() {
        let tent = Shape::tent(33, 4);
        let pay = |bin: u8| redemption(STATUS_SETTLED, bin, tent, 100, 999, 0, 0).unwrap();
        assert_eq!(pay(33), 400);
        assert_eq!(pay(32), 300);
        assert_eq!(pay(35), 200);
        assert_eq!(pay(36), 100);
        assert_eq!(pay(37), 0);
        assert_eq!(redemption(STATUS_SETTLED, 40, Shape::band(20, 44), 200, 0, 0, 0), Some(200));
    }

    #[test]
    fn a_void_refunds_what_was_paid_not_what_it_was_marked_at() {
        let any = Shape::tent(10, 2);
        // nothing left before the void: exactly the cost basis, whatever the
        // shares were "worth" (vault == claims)
        assert_eq!(redemption(STATUS_VOID, NO_BIN, any, 1_000_000, 28_076_652, 9_000_000_000, 9_000_000_000), Some(28_076_652));
        // a shortfall is shared, not raced for
        assert_eq!(redemption(STATUS_VOID, NO_BIN, any, 5, 1_000, 750, 1_000), Some(750));
        assert_eq!(redemption(STATUS_VOID, NO_BIN, any, 5, 0, 0, 0), Some(0));
    }

    /// The attack the second audit measured: A buys a bin cheap, P pumps it,
    /// A sells into P, P holds into a void it saw coming. The vault is short
    /// by A's gain. Depositors must still get their deposit back; P wears
    /// A's gain, so the pair nets nothing from the house.
    #[test]
    fn a_void_pays_depositors_first_and_traders_share_the_rest() {
        let (deposit, p_paid, a_gain) = (5_000u64, 8_070u64, 4_434u64);
        let vault = deposit + p_paid - a_gain;
        let (lp, traders) = void_pots(vault, deposit, p_paid);
        assert_eq!(lp, deposit, "the house is whole");
        assert_eq!(traders, p_paid - a_gain);
        let p_back = void_share(p_paid, traders, p_paid);
        assert_eq!(p_back + a_gain, p_paid, "the pair nets zero");
        // two depositors, pro rata and never more than the pot
        assert_eq!(void_share(3_000, lp, deposit) + void_share(2_000, lp, deposit), deposit);
        // a vault short of every deposit: depositors share it, traders get nothing
        assert_eq!(void_pots(4_000, 5_000, 1), (4_000, 0));
        // nobody holds a line: all of it goes to the depositors
        assert_eq!(void_pots(5_150, 5_000, 0), (5_150, 0));
        // a seller who realised a loss leaves a surplus: it goes to open lines
        assert_eq!(void_pots(5_000 + 500 + 150, 5_000, 500), (5_000, 650));
    }

    #[test]
    fn a_round_trades_for_at_most_a_day_and_locks_a_twenty_fourth_before_its_close() {
        let close = 1_000_000_000;
        // started a week ahead: opens a day before its close, locks an hour before
        assert_eq!(round_times(close - 7 * 86_400, close), (close - 86_400, close - 3_600));
        // started at noon for a 4pm close: opens in a minute, locks 10 minutes before
        let (o, l) = round_times(close - 4 * 3_600, close);
        assert_eq!(o, close - 4 * 3_600 + 60);
        assert_eq!(l, close - (4 * 3_600 - 60) / 24);
        // the shortest round still locks two minutes before
        let (o, l) = round_times(close - MIN_ROUND_SECS, close);
        assert!(o < l);
        assert_eq!(close - l, LOCK_GAP_MIN_SECS);
    }

    #[test]
    fn nothing_is_redeemable_before_the_market_is_final() {
        let s = Shape::band(1, 2);
        assert_eq!(redemption(STATUS_SEEDING, 0, s, 1, 1, 1, 1), None);
        assert_eq!(redemption(STATUS_OPEN, 0, s, 1, 1, 1, 1), None);
    }

    #[test]
    fn lps_share_pro_rata_and_never_more_than_the_pool() {
        assert_eq!(lp_share(1_000, 250, 1_000), 250);
        assert_eq!(lp_share(1_000, 1, 3), 333, "floors");
        let parts: u64 = [1u64, 1, 1].iter().map(|s| lp_share(1_000, *s, 3)).sum();
        assert!(parts <= 1_000);
        assert_eq!(lp_share(1_000, 5, 0), 0);
    }

    #[test]
    fn the_settler_takes_half_the_protocols_cut_and_the_split_never_over_pays() {
        assert_eq!(settle_bounty(1_000), 500);
        assert_eq!(settle_bounty(1), 0);
        assert_eq!(settle_bounty(0), 0);
        for f in [3u64, 999, 1_000_001] {
            assert!(settle_bounty(f) <= f);
        }
    }

    #[test]
    fn a_tranches_principal_rounds_against_it_and_never_goes_negative() {
        let wad = crate::math::WAD;
        assert_eq!(tranche_principal(1_000_000, 0, 6), Some(1_000_000));
        assert_eq!(tranche_principal(1_000_000, wad / 2 + 1, 6), Some(1_500_000), "gain floors");
        assert_eq!(tranche_principal(1_000_000, -(wad / 2 + 1), 6), Some(499_999), "loss ceils");
        assert_eq!(tranche_principal(1_000_000, -5 * wad, 6), Some(0));
    }

    #[test]
    fn a_tranche_earns_only_the_fees_accrued_after_it_joined() {
        let mut l: Ladder = bytemuck::Zeroable::zeroed();
        // Alone: the first tranche (b = 1,000) takes the whole of the first fee.
        l.accrue_lp_fee(800, 1_000);
        let snap = l.acc_fee();
        // A second tranche of b = 3,000 joins; the next fee splits 1:3.
        l.accrue_lp_fee(800, 4_000);
        let first = tranche_fees(1_000, l.acc_fee(), 0).unwrap();
        let second = tranche_fees(3_000, l.acc_fee(), snap).unwrap();
        assert_eq!(first, 800 + 200);
        assert_eq!(second, 600);
        assert_eq!(first + second, 1_600);
        assert_eq!(tranche_fees(1, 5, 9), None, "an accumulator never runs backwards");
    }
}

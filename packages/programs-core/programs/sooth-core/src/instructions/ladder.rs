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
use crate::math::ladder::{apply_trade, fresh, Shape, BINS};
use crate::math::{scalar_for, wad_div, wad_to_amount_ceil, wad_to_amount_floor, LN2_WAD};
use crate::oracle::{read_settlement_price, OraclePolicy};
use crate::state::ladder::*;
use crate::state::{require_not_paused, ProtocolConfig, PROTOCOL_CONFIG_SEED};

/// Highest fee a market may charge. A creator who could set 100% could take the
/// next trade whole.
pub const MAX_LADDER_FEE_BPS: u16 = 500;

/// The gap between the last trade and the settlement read. Nobody should be
/// able to trade against a price they can already watch forming.
pub const MIN_LOCK_GAP_SECS: i64 = 60;

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

/// Share of the subsidy actually committed to `b`. The sliver held back absorbs
/// base-unit rounding so the LMSR bound holds in integers, not just in reals.
const B_HAIRCUT_NUM: i128 = 9_999;
const B_HAIRCUT_DEN: i128 = 10_000;

// ── pure helpers, tested below ───────────────────────────────────────────────

/// Fee on `amount`, never zero — a dust trade that paid no fee would be a free
/// way to churn state — and never more than the amount itself, so a dust
/// position can always be sold.
pub fn fee_on(amount: u64, fee_bps: u16) -> u64 {
    let raw = (amount as u128 * fee_bps as u128 + 9_999) / 10_000;
    (raw.max(1) as u64).min(amount)
}

/// 80% to LPs, 10% to the creator, the remainder to the protocol. The protocol
/// takes the remainder rather than a computed tenth so the three always sum to
/// the fee exactly.
pub fn split_fee(fee: u64) -> (u64, u64, u64) {
    let lp = (fee as u128 * 80 / 100) as u64;
    let creator = (fee as u128 * 10 / 100) as u64;
    (lp, creator, fee - lp - creator)
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

// ── create ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LadderCreateArgs {
    pub feed_id: [u8; 32],
    pub tier: u8,
    pub opens_at: i64,
    pub locks_at: i64,
    pub settles_at: i64,
    /// The creator's subsidy, in quote base units.
    pub seed: u64,
    pub fee_bps: u16,
    /// Who the market is presented as funded by. Attribution only.
    pub sponsor: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: LadderCreateArgs)]
pub struct LadderCreate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [PROTOCOL_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    /// One market per (feed, settlement time, quote mint, tier). The tier is in
    /// the seeds so a slot cannot be squatted with a useless step.
    #[account(
        init,
        payer = creator,
        space = Ladder::SPACE,
        seeds = [
            LADDER_SEED,
            args.feed_id.as_ref(),
            &args.settles_at.to_le_bytes(),
            quote_mint.key().as_ref(),
            &[args.tier],
        ],
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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_handler(ctx: Context<LadderCreate>, args: LadderCreateArgs) -> Result<()> {
    require_not_paused(&ctx.accounts.config)?;

    // Can this protocol hold the quote token at all? Asked before anything is
    // written: a market around a transfer-fee mint fails at its first deposit.
    crate::token_guard::assert_mint_is_custodiable(&ctx.accounts.quote_mint.to_account_info())?;

    require!((args.tier as usize) < STEP_BPS.len(), SoothCoreError::LadderBadTier);
    require!(args.fee_bps <= MAX_LADDER_FEE_BPS, SoothCoreError::LadderBadFee);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < args.opens_at
            && args.opens_at < args.locks_at
            && args.locks_at + MIN_LOCK_GAP_SECS <= args.settles_at,
        SoothCoreError::LadderBadTimes
    );

    // At least one whole quote token. Below that `b` rounds to nothing and a
    // single small trade moves a bin from 2% to 80%.
    let decimals = ctx.accounts.quote_mint.decimals;
    let one_token = 10u64.checked_pow(decimals as u32).ok_or(SoothCoreError::MathOverflow)?;
    require!(args.seed >= one_token, SoothCoreError::LadderSeedTooSmall);

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.creator_token.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        args.seed,
        decimals,
    )?;

    let mut l = ctx.accounts.ladder.load_init()?;
    l.opens_at = args.opens_at;
    l.locks_at = args.locks_at;
    l.settles_at = args.settles_at;
    l.cash = args.seed;
    l.seed_total = args.seed;
    l.step_bps = STEP_BPS[args.tier as usize];
    l.fee_bps = args.fee_bps;
    l.feed_id = args.feed_id;
    l.quote_mint = ctx.accounts.quote_mint.key();
    l.vault = ctx.accounts.vault.key();
    l.creator = ctx.accounts.creator.key();
    l.sponsor = if args.sponsor == Pubkey::default() {
        ctx.accounts.creator.key()
    } else {
        args.sponsor
    };
    let (w, sum) = fresh();
    l.store_curve(&w, sum);
    l.status = STATUS_SEEDING;
    l.settled_bin = NO_BIN;
    l.tier = args.tier;
    l.quote_decimals = decimals;
    l.bump = ctx.bumps.ladder;
    l.authority_bump = ctx.bumps.authority;
    l.vault_bump = ctx.bumps.vault;
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

    // b = 0.9999 · seed / ln(64). An LMSR over N outcomes can lose at most
    // b·ln N, so this is the largest b the seed fully covers.
    let seed_wad = (l.seed_total as i128)
        .checked_mul(scalar_for(l.quote_decimals) as i128)
        .and_then(|v| v.checked_mul(B_HAIRCUT_NUM))
        .map(|v| v / B_HAIRCUT_DEN)
        .ok_or(SoothCoreError::MathOverflow)?;
    let ln_bins = LN2_WAD * 6; // ln 64
    debug_assert_eq!(BINS, 64);
    let b = math(wad_div(seed_wad, ln_bins))?;
    require!(b > 0, SoothCoreError::LadderSeedTooSmall);
    l.set_b_wad(b);

    l.status = STATUS_OPEN;
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

        let (to_lp, to_creator, to_protocol) = split_fee(fee);
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

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            total,
            decimals,
        )?;
        pos.shares = pos.shares.checked_add(size).ok_or(SoothCoreError::MathOverflow)?;
        pos.net_paid = pos.net_paid.checked_add(total).ok_or(SoothCoreError::MathOverflow)?;
    } else {
        let out = amount - fee; // fee_on never exceeds amount
        require!(out >= args.limit, SoothCoreError::SlippageExceeded);

        let released = basis_released(pos.net_paid, size, pos.shares);
        pos.net_paid -= released;
        pos.shares -= size;

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
        assert_eq!(split_fee(100), (80, 10, 10));
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
    fn the_liquidity_the_seed_buys_covers_the_worst_case() {
        // seed 5,000 tokens at 6 decimals → b such that b·ln64 ≤ seed.
        let seed_wad = 5_000i128 * crate::math::WAD * B_HAIRCUT_NUM / B_HAIRCUT_DEN;
        let b = wad_div(seed_wad, LN2_WAD * 6).unwrap();
        let worst = crate::math::wad_mul(b, LN2_WAD * 6).unwrap();
        assert!(worst <= 5_000 * crate::math::WAD);
        assert!(worst > 4_999 * crate::math::WAD, "and wastes almost none of it");
    }
}

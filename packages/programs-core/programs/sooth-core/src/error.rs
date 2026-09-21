//! Error codes for `sooth_core`.
//!
//! Discriminants are ABI-stable — don't reorder, delete, or insert into the
//! middle once shipped. Anchor numbers these positionally from 6000, the
//! deployed program reports those numbers, and the SDK's error classifier
//! maps them back to names by ordinal. Removing a variant nothing raises
//! today would renumber every variant after it, so unraised variants stay as
//! reserved slots; append new ones at the end.

use anchor_lang::prelude::*;

#[error_code]
pub enum SoothCoreError {
    // ── Market lifecycle ─────────────────────────────────────────────────────
    #[msg("Market is not in the Open lifecycle state")]
    MarketNotOpen,

    #[msg("Market is not Settled")]
    MarketNotSettled,

    #[msg("Lifecycle transition not permitted from current state")]
    InvalidLifecycleTransition,

    #[msg("Invalid outcome (must be NO=0, YES=1, or INVALID=2)")]
    InvalidOutcome,

    #[msg("Amount must be non-zero")]
    ZeroAmount,

    #[msg("Insufficient outcome-token balance")]
    InsufficientOutcomeShares,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Vault / mint authority mismatch")]
    VaultAuthorityMismatch,

    #[msg("Deadline must be greater than start_time")]
    InvalidDeadline,

    #[msg("Adjudicator pubkey must not be the default (all-zero) key")]
    AdjudicatorIsDefault,

    #[msg("Market is not dismissed")]
    MarketNotDismissed,

    #[msg("Trading window has closed (now >= deadline)")]
    TradingClosed,

    #[msg("Invalid tick")]
    InvalidTick,

    #[msg("Amount too small for base token decimals")]
    AmountTooSmallForBaseTokenDecimals,

    /// The AMM mint's decimals fall outside what the WAD conversion supports.
    /// Above 18 the base-unit-to-WAD scalar underflows; below 2 a share cannot
    /// carry useful price precision.
    #[msg("AMM mint decimals must be between 2 and 18")]
    UnsupportedMintDecimals,

    /// The mint carries a Token-2022 extension this protocol cannot custody
    /// honestly — a transfer fee, a permanent delegate, a transfer hook, or
    /// anything else that breaks "a transfer of n delivers n, and only the
    /// owner moves it". See `token_guard`.
    #[msg("Mint carries a Token-2022 extension that cannot be custodied")]
    UnsupportedMintExtension,

    // ── Oracle settlement ────────────────────────────────────────────────────
    // Each refusal is its own code: the settle crank has to tell "post a
    // fresher update and retry" apart from "this feed cannot settle this market".
    #[msg("Oracle account is not owned by the Pyth receiver program")]
    OracleWrongOwner,
    #[msg("Oracle account is not a PriceUpdateV2")]
    OracleAccountMalformed,
    #[msg("Oracle price is for a different feed than the market committed to")]
    OracleWrongFeed,
    #[msg("Oracle update carries fewer guardian signatures than required")]
    OracleUnderVerified,
    #[msg("Oracle price is older than the market allows, or from the future")]
    OracleStale,
    #[msg("Oracle price is not positive")]
    OracleNonPositive,
    #[msg("Oracle confidence interval is wider than the market allows")]
    OracleTooUncertain,
    #[msg("Oracle update is not the first one at the settlement instant")]
    OracleNotTheSettlementInstant,
    #[msg("Oracle price exponent differs from the one the grid was centred on")]
    OracleExponentChanged,

    // ── Ladder markets ───────────────────────────────────────────────────────
    #[msg("Unknown step tier")]
    LadderBadTier,
    #[msg("Fee is above the ladder maximum")]
    LadderBadFee,
    #[msg("Ladder times must satisfy now < opens < locks, and lock at least a minute before settlement")]
    LadderBadTimes,
    #[msg("Seed is below one whole quote token")]
    LadderSeedTooSmall,
    #[msg("Ladder is not in its seeding phase")]
    LadderNotSeeding,
    #[msg("Ladder is not open for trading")]
    LadderNotOpen,
    #[msg("Trade size is zero")]
    LadderZeroTrade,
    #[msg("Position holds fewer shares than the sale")]
    LadderInsufficientShares,
    #[msg("Pool cash would not cover its largest payout")]
    LadderInsolvent,
    #[msg("Ladder cannot be settled yet, or already was")]
    LadderNotSettleable,
    #[msg("Ladder cannot be voided: it can still open or settle")]
    LadderNotVoidable,
    #[msg("Ladder is neither settled nor void")]
    LadderNotFinal,
    #[msg("Account does not belong to this ladder or owner")]
    LadderWrongAccount,
    #[msg("Ladder takes liquidity only while seeding or open, before lock")]
    LadderNotJoinable,
    #[msg("A trade landed since this join was priced; read the curve again")]
    LadderCurveMoved,

    // ── AMM ──────────────────────────────────────────────────────────────────
    #[msg("Slippage: cost exceeded max_cost_wad")]
    SlippageExceeded,

    #[msg("delta_shares must be non-zero")]
    ZeroDelta,

    #[msg("Insufficient shares to sell")]
    InsufficientShares,

    #[msg("Market is dismissed")]
    MarketDismissed,

    #[msg("Liquidity parameter b must be > 0")]
    InvalidLiquidity,

    #[msg("Caller is not authorized for this action (creator mismatch)")]
    Unauthorized,

    #[msg("Trading window has not started yet (now < start_time)")]
    TradingNotStarted,

    #[msg("Sell path is not implemented yet — see trade_positions.rs §6 / architecture §4.3")]
    SellNotImplemented,

    #[msg("Lock has not elapsed yet (now < lock_entry.unlock_at)")]
    LockNotElapsed,

    #[msg("Lock vault account does not match market.lock_vault")]
    LockVaultMismatch,

    #[msg("Trial period has not expired yet")]
    TrialNotExpired,

    #[msg("Market has already graduated")]
    AlreadyGraduated,

    #[msg("Market has already been dismissed")]
    AlreadyDismissed,

    #[msg("AmmState market backlink does not match market account")]
    AmmStateMarketMismatch,

    // ── Market creation / LP ─────────────────────────────────────────────────
    #[msg("Fee bps must not exceed 10000 (100%)")]
    FeeBpsOutOfRange,

    #[msg("Fee split bps do not sum to 10000")]
    FeeSplitMismatch,

    #[msg("Treasury pubkey must be non-default")]
    InvalidTreasury,

    #[msg("Default trial period must be > 0")]
    InvalidTrialPeriod,

    #[msg("Fee pool is empty — nothing to distribute")]
    NothingToDistribute,

    #[msg("Market is not graduated")]
    NotGraduated,

    #[msg("LP amount must be > 0")]
    ZeroLpAmount,

    #[msg("LP supply is empty")]
    EmptyLpSupply,

    #[msg("Legacy fee drain already executed")]
    LegacyDrainAlreadyExecuted,

    // ── Adjudicator / resolution ─────────────────────────────────────────────
    #[msg("Caller is not the registered authority for this adjudicator")]
    NotAuthority,

    #[msg("Adjudicator has already attested an outcome; re-attestation is not permitted")]
    AlreadyAttested,

    #[msg("Adjudicator account does not match the supplied market")]
    AdjudicatorMarketMismatch,

    #[msg("Adjudicator has already been disputed; dispute is one-shot per market")]
    AlreadyDisputed,

    #[msg("Market is already settled; dispute can no longer override the outcome")]
    MarketAlreadySettled,

    // ── Orderbook (CLOB) ─────────────────────────────────────────────────────
    #[msg("Order id is outside the supported composite encoding range")]
    InvalidOrderId,

    #[msg("Decoded order id does not match the requested side or tick")]
    OrderIdSeedMismatch,

    #[msg("Book side is full for this tick")]
    BookSideFull,

    #[msg("Book side is not fully drained")]
    BookSideNotDrained,

    #[msg("Compaction drop count exceeds the per-call bound")]
    CompactBoundExceeded,

    #[msg("Market vault uses the wrong base mint")]
    WrongBaseMint,

    #[msg("MarketBook base mint does not match the market vault mint")]
    BaseMintDrift,

    #[msg("MarketBook accumulators must be reset before placing an order")]
    AccumulatorNotReset,

    #[msg("No cancellable order was found")]
    NoCancellableOrder,

    #[msg("Remaining-account bundle does not carry the crossing BookSide")]
    MissingCrossingBookSide,

    #[msg("Remaining-account bundle maker does not match the live order maker")]
    MakerAccountMismatch,

    #[msg("Remaining-account bundles must contain exactly three accounts per fill")]
    WrongBundleArity,

    // ── Protocol / circuit-breaker ───────────────────────────────────────────
    #[msg("Protocol is paused; trading, new liquidity and market creation are disabled")]
    ProtocolPaused,

    #[msg("Adjudicator has not yet attested an outcome for this market")]
    NotYetAttested,

    #[msg("Trading window has not closed yet (now < deadline)")]
    TradingNotClosed,

    #[msg("Serialized event payload exceeds the 10 KiB instruction-data limit")]
    EventTooLarge,

    // ── Veto window ──────────────────────────────────────────────────────────
    // Appended, never reordered: these discriminants are the on-the-wire error
    // codes the SDK and demo match on.
    #[msg("Veto window is still open; settle is not callable until it closes")]
    VetoWindowOpen,

    #[msg("Veto window has closed; the attested outcome can no longer be disputed")]
    VetoWindowClosed,

    #[msg("veto_period_secs must be > 0 and <= MAX_VETO_PERIOD_SECS")]
    InvalidVetoPeriod,

    #[msg("seed_deposit_wad must cover the LMSR worst-case subsidy b*ln(2)")]
    InsufficientSeedDeposit,

    #[msg("Book account is malformed, mis-sized or has the wrong discriminator")]
    InvalidBookAccount,

    #[msg("Order placement or matching failed")]
    MatchFailed,

    #[msg("Requested book capacity exceeds the per-instruction realloc limit")]
    BookCapacityTooLarge,
    #[msg("Question is empty or exceeds the maximum length")]
    InvalidQuestion,
    #[msg("question_hash is not the hash of the supplied question")]
    QuestionHashMismatch,
    #[msg("Market is not in a closeable state")]
    MarketNotClosable,
    #[msg("A vault still holds funds — every claim must be paid before close")]
    VaultNotEmpty,
    #[msg("A fee pool still holds funds — distribute before close")]
    FeePoolNotEmpty,
    #[msg("The book still has live orders or funded seats")]
    BookNotEmpty,
    #[msg("Winning shares are still unredeemed — the balance is owed, not residual")]
    OutstandingClaims,
    // ── zkTLS adjudication ───────────────────────────────────────────────────
    // Appended, never reordered. See the module header.
    #[msg("Adjudicator entry is not zk-enabled; use the manual attest path")]
    ZkNotEnabled,

    #[msg("An attestation field exceeds its maximum encoded length")]
    ZkAttestationFieldTooLong,

    #[msg("Signature v byte must be 27 or 28")]
    ZkInvalidSignatureV,

    #[msg("Signature s value is above secp256k1n/2 and therefore malleable")]
    ZkMalleableSignature,

    #[msg("secp256k1 public-key recovery failed for this attestation")]
    ZkSignatureRecoveryFailed,

    #[msg("Recovered attestor does not match the address registered for this market")]
    ZkAttestorMismatch,

    #[msg("Attestation url and parsePath do not match the registered rule_hash")]
    ZkRuleHashMismatch,

    #[msg("A zk attestation must carry exactly one responseResolve entry")]
    ZkResponseResolveCountInvalid,

    #[msg("Attested data is not a bare decimal or a single-key object holding one")]
    ZkDataUnparseable,

    #[msg("Attested value carries more fractional digits than the registered scale")]
    ZkValuePrecisionTooHigh,

    #[msg("Attested value does not fit the fixed-point range")]
    ZkValueOutOfRange,

    #[msg("Comparator discriminant is not a known ZkComparator")]
    ZkInvalidComparator,

    #[msg("value_scale exceeds MAX_ZK_VALUE_SCALE")]
    ZkInvalidValueScale,

    #[msg("Attestation timestamp is outside the accepted window")]
    ZkAttestationTimestampInvalid,

    // ── Raw `Position` parsing (claim_refund) ────────────────────────────────
    // Appended, never reordered. `claim_refund` reads the Position out of the
    // raw account buffer rather than through `Account<Position>`, so Anchor
    // raises none of its own errors on that path and every distinct failure
    // used to surface as `VaultAuthorityMismatch` — a name that points a
    // debugger at the vault when the fault is in the position.
    #[msg("Position account is not the PDA for this (market, user) pair")]
    PositionAddressMismatch,

    #[msg("Position account is not owned by sooth_core")]
    PositionOwnerMismatch,

    #[msg("Position account buffer is shorter than a serialized Position")]
    PositionMalformed,

    #[msg("Position.user does not match the signer")]
    PositionUserMismatch,

    #[msg("Position.market does not match the supplied market")]
    PositionMarketMismatch,

    // Appended, never reordered. A market whose LMSR subsidy was never posted
    // by `seed_lp` has no liquidity behind its curve, so every trade against
    // it prices shares the vault cannot pay. It used to fail at account
    // validation with Anchor's `AccountNotInitialized` on the LP mint — a
    // message that names the wrong problem.
    #[msg("Market has no LMSR seed: seed_lp must run before it can trade")]
    MarketNotSeeded,

    // Appended, never reordered. The creator's subsidy is the collateral
    // behind a dismissed market's refunds, so it cannot leave while one is
    // outstanding.
    #[msg("Dismissed market still owes refunds; the subsidy cannot be reclaimed")]
    RefundsOutstanding,

    // Appended, never reordered. A PDA that already carries data, or that is
    // already assigned away from the system program, is a live account — a
    // market, a mint, or the tombstone of a closed market. Creating over it
    // would resurrect a spent id, so `pda::create_pda_account` refuses.
    #[msg("Target PDA is already initialized and cannot be created again")]
    PdaAlreadyInitialized,

    // Appended, never reordered. The LP-yield remainder may only be swept to
    // the treasury once no LP token exists to claim it.
    #[msg("LP supply is nonzero: holders can still redeem this yield themselves")]
    LpSupplyNotZero,

    // Appended, never reordered. `accept_authority` was called on a config
    // with no nomination in flight. Distinct from `Unauthorized` so a caller
    // who accepted before the outgoing authority nominated them can tell the
    // two apart.
    #[msg("No authority transfer is pending on this protocol config")]
    NoPendingAuthority,

    // Appended, never reordered. An `AdjudicatorEntry` account was supplied
    // that this program does not own, so its contents are whatever somebody
    // else wrote there.
    #[msg("Adjudicator entry account is not owned by sooth_core")]
    AdjudicatorEntryOwnerMismatch,

    #[msg("Early zk attestation must prove the rule SATISFIED — an unmet reading proves nothing before the deadline")]
    ZkEarlyRequiresSatisfied,

    // ── Bonded optimistic resolution. Appended, never reordered. ──
    #[msg("Market has a registered adjudicator — optimistic proposals only run where no one owns the truth")]
    OptNotEligible,

    #[msg("Optimistic proposals open at the deadline, not before")]
    OptTooEarly,

    #[msg("Bond is below the minimum")]
    OptBondTooSmall,

    #[msg("Bond token account does not match the market's collateral mint")]
    OptBondMintMismatch,

    #[msg("Challenge window has closed — the assertion can only be finalized now")]
    OptChallengeWindowClosed,

    #[msg("Challenge window is still open — a finalize must outwait it")]
    OptChallengeWindowOpen,

    #[msg("Proposal is already challenged")]
    OptAlreadyChallenged,

    #[msg("Proposal has no challenge to arbitrate")]
    OptNotChallenged,

    #[msg("Proposal already paid out")]
    OptAlreadyResolved,

    #[msg("Only the market's designated adjudicator arbitrates a challenge")]
    OptNotArbiter,

    #[msg("Payout account does not belong to the party owed")]
    OptWrongRecipient,

    #[msg("A proposer cannot challenge their own assertion")]
    OptSelfChallenge,

    // ── Guardian hardening. Appended, never reordered. ──
    #[msg("The veto has fired its maximum number of times on this market — the ruling stands")]
    TooManyDisputes,

    #[msg("Guardian set is full")]
    GuardianSetFull,

    #[msg("Not a guardian of this market")]
    GuardianNotFound,

    #[msg("Already a guardian of this market")]
    GuardianAlreadyPresent,

    #[msg("Quorum threshold must be between 1 and the roster size")]
    QuorumThresholdInvalid,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Anchor numbers these positionally from 6000 and the deployed program
    /// reports the NUMBER; the SDK maps it back to a name through the IDL. So
    /// the ordinals are the wire format, and this pins the two ends of the
    /// enum: an insertion anywhere in the middle moves every variant after it
    /// and breaks every client already in the field.
    #[test]
    fn discriminants_are_append_only() {
        assert_eq!(SoothCoreError::MarketNotOpen as u32 + 6000, 6000);
        // The zk block closed the enum before the Position-parsing variants
        // were appended; both must stay last, in this order.
        assert_eq!(
            SoothCoreError::PositionMarketMismatch as u32,
            SoothCoreError::ZkAttestationTimestampInvalid as u32 + 5
        );
        // `MarketNotSeeded` was appended after them and is now the last
        // variant. Anything added later goes after it, never before.
        assert_eq!(
            SoothCoreError::MarketNotSeeded as u32,
            SoothCoreError::PositionMarketMismatch as u32 + 1
        );
        assert_eq!(
            SoothCoreError::RefundsOutstanding as u32,
            SoothCoreError::MarketNotSeeded as u32 + 1
        );
        assert_eq!(
            SoothCoreError::PdaAlreadyInitialized as u32,
            SoothCoreError::RefundsOutstanding as u32 + 1
        );
        assert_eq!(
            SoothCoreError::LpSupplyNotZero as u32,
            SoothCoreError::PdaAlreadyInitialized as u32 + 1
        );
        assert_eq!(
            SoothCoreError::NoPendingAuthority as u32,
            SoothCoreError::LpSupplyNotZero as u32 + 1
        );
        assert_eq!(
            SoothCoreError::AdjudicatorEntryOwnerMismatch as u32,
            SoothCoreError::NoPendingAuthority as u32 + 1
        );
    }

    /// `claim_refund` used to report all of these as `VaultAuthorityMismatch`,
    /// which sent a debugger to look at the vault for a fault in the position.
    #[test]
    fn the_position_parse_failures_are_all_distinct() {
        let codes = [
            SoothCoreError::PositionAddressMismatch as u32,
            SoothCoreError::PositionOwnerMismatch as u32,
            SoothCoreError::PositionMalformed as u32,
            SoothCoreError::PositionUserMismatch as u32,
            SoothCoreError::PositionMarketMismatch as u32,
            SoothCoreError::VaultAuthorityMismatch as u32,
        ];
        for (i, a) in codes.iter().enumerate() {
            for b in &codes[i + 1..] {
                assert_ne!(a, b, "two failures share one error code");
            }
        }
    }
}

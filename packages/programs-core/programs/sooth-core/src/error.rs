//! Errors of `sooth_core`. Numbered from 6000 by Anchor, in declaration order;
//! append, never reorder.

use anchor_lang::prelude::*;

#[error_code]
pub enum SoothCoreError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Slippage: the trade moved past the limit given")]
    SlippageExceeded,
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("Protocol is paused; trading, new liquidity and market creation are disabled")]
    ProtocolPaused,
    #[msg("No authority transfer is pending")]
    NoPendingAuthority,

    // ── Quote mints ──────────────────────────────────────────────────────────
    #[msg("Mint carries a Token-2022 extension that cannot be custodied")]
    UnsupportedMintExtension,
    #[msg("Mint gives its issuer power over holders; the protocol authority must approve it first")]
    MintNeedsApproval,

    // ── Oracle settlement ────────────────────────────────────────────────────
    // Each is its own code so a keeper can tell "post a fresher update and
    // retry" apart from "this feed cannot settle this market".
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
}

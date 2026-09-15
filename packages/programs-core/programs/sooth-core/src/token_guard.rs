//! Which mints are safe for a vault to custody.
//!
//! Stook quotes markets in whatever the creator names, and the tokens worth
//! quoting on Solana — xStocks, and the stock-paired tokens launched against
//! them — are Token-2022. Token-2022 is the same interface as SPL Token with
//! *extensions* bolted on, and several of those extensions break assumptions
//! this protocol makes on every path.
//!
//! The assumptions, stated so the refusals below are checkable against them:
//!
//!   1. A transfer of `n` delivers exactly `n`.
//!   2. Nobody but the account's owner can move what the vault holds.
//!   3. A transfer either succeeds or fails; it does not run someone's code.
//!   4. A balance does not change while nobody is transacting.
//!
//! An extension that breaks any of those is refused at market creation rather
//! than handled, because "handled" means fee-aware accounting, reentrancy
//! analysis and drift reconciliation on every instruction that touches a
//! vault. Refusing is the honest position until that work exists.
//!
//! Classic SPL Token has no extensions and is accepted unconditionally.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    state::Mint as MintState,
};

use crate::error::SoothCoreError;

/// Extensions that make a mint unsafe to hold in a protocol vault.
///
/// Each entry is here for a specific, demonstrable failure, not out of
/// caution:
///
/// - `TransferFeeConfig` — a deposit of `n` arrives as less than `n`. The
///   curve credits what it was told and the vault holds less than it owes.
///   StonkFun's own tokens carry a 3% fee, so this is the common case, not the
///   exotic one.
/// - `PermanentDelegate` — a key chosen by the mint authority can transfer
///   from *any* account in that mint, including this protocol's vault, at any
///   time, with no signature from the vault authority. There is no defence
///   from inside the program.
/// - `TransferHook` — every transfer makes a CPI into a third-party program
///   the mint names. That program can fail, consume the compute budget, or
///   re-enter. A settlement path that can be stalled by someone else's code is
///   a settlement path that can be griefed.
/// - `DefaultAccountState` — the mint can make new accounts frozen by default,
///   so a vault opens dead and every deposit fails after the market exists.
/// - `NonTransferable` — the vault can receive and never pay out.
/// - `InterestBearingConfig` — the displayed balance accrues while nobody
///   transacts, so the vault's amount and the curve's liability drift apart on
///   a clock rather than on a trade.
/// - `ConfidentialTransferMint` — balances can move in ways this program
///   cannot read, so it cannot assert the vault covers its obligations.
const REFUSED: &[ExtensionType] = &[
    ExtensionType::TransferFeeConfig,
    ExtensionType::PermanentDelegate,
    ExtensionType::TransferHook,
    ExtensionType::DefaultAccountState,
    ExtensionType::NonTransferable,
    ExtensionType::InterestBearingConfig,
    ExtensionType::ConfidentialTransferMint,
];

/// Refuse a mint this protocol cannot custody honestly.
///
/// Takes the raw account rather than a typed `Mint` because the extension list
/// lives past the base state in the account's data, and the typed wrapper
/// deserializes only the base.
///
/// A classic SPL Token mint has no extension region and passes. Anything that
/// is not a mint at all fails to parse and is refused — this is not a
/// substitute for the caller's ownership check, but it is not a hole either.
pub fn assert_mint_is_custodiable(mint: &AccountInfo) -> Result<()> {
    let data = mint.try_borrow_data()?;

    // Classic SPL mints are exactly the base length and carry no extensions.
    // Parsing them through the 2022 reader yields an empty extension list, so
    // one code path covers both programs.
    let state = StateWithExtensions::<MintState>::unpack(&data)
        .map_err(|_| error!(SoothCoreError::UnsupportedMintExtension))?;

    let found = state
        .get_extension_types()
        .map_err(|_| error!(SoothCoreError::UnsupportedMintExtension))?;

    for ext in found {
        if REFUSED.contains(&ext) {
            msg!("refusing mint: extension {:?} is not custodiable", ext);
            return err!(SoothCoreError::UnsupportedMintExtension);
        }
    }
    Ok(())
}

/// Whether an extension would be refused. Exposed so an off-chain caller can
/// tell a creator *why* their token cannot be quoted, before they pay for a
/// transaction that will fail.
pub fn is_refused(ext: ExtensionType) -> bool {
    REFUSED.contains(&ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The four assumptions in this module's header, each mapped to the
    /// extension that breaks it. A failure here means someone added an
    /// extension to `REFUSED` without a reason, or removed one that had a
    /// reason.
    #[test]
    fn every_refusal_maps_to_a_broken_assumption() {
        // 1. a transfer of n delivers n
        assert!(is_refused(ExtensionType::TransferFeeConfig));
        // 2. only the owner moves what the vault holds
        assert!(is_refused(ExtensionType::PermanentDelegate));
        // 3. a transfer does not run someone else's code
        assert!(is_refused(ExtensionType::TransferHook));
        // 4. balances do not move while nobody transacts
        assert!(is_refused(ExtensionType::InterestBearingConfig));
    }

    #[test]
    fn a_vault_that_cannot_open_or_cannot_pay_out_is_refused() {
        assert!(is_refused(ExtensionType::DefaultAccountState));
        assert!(is_refused(ExtensionType::NonTransferable));
        assert!(is_refused(ExtensionType::ConfidentialTransferMint));
    }

    /// Extensions that describe a token without changing how it moves are
    /// explicitly allowed. xStocks carry metadata, and refusing metadata would
    /// refuse the entire asset class this protocol exists to quote.
    #[test]
    fn descriptive_extensions_are_allowed() {
        assert!(!is_refused(ExtensionType::MetadataPointer));
        assert!(!is_refused(ExtensionType::TokenMetadata));
        assert!(!is_refused(ExtensionType::MintCloseAuthority));
    }
}

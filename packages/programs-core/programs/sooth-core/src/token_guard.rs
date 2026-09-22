//! Which mints a vault may custody, and on whose say-so.
//!
//! Stook quotes markets in whatever the creator names, and the tokens worth
//! quoting on Solana — xStocks, and the stock-paired tokens launched against
//! them — are Token-2022: the SPL Token interface with *extensions* bolted on.
//! Some extensions break assumptions this protocol makes on every path; some
//! hand the issuer a power over every holder; most only describe the token.
//!
//! The assumptions, stated so the verdicts below are checkable against them:
//!
//!   1. A transfer of `n` delivers exactly `n`.
//!   2. A transfer either succeeds or fails; it does not run someone's code.
//!   3. The vault can receive, and can pay out.
//!   4. Nobody but the vault's authority moves what the vault holds.
//!
//! An extension that breaks 2–3 is `Refused`: handling it means reentrancy
//! analysis on every vault path, and that work does not exist.
//!
//! A transfer fee breaks 1, and IS handled: every deposit is credited by what
//! the vault says arrived, not by what was sent (`instructions::ladder::pull`).
//! The fee authority can change the rate at will, which is an issuer power, so
//! a fee-bearing mint is `IssuerTrusted`. StonkFun sets 1% on every launch —
//! $STOOK included — so this is the common case, not the exotic one.
//!
//! An extension that breaks 4 cannot be handled at all — a permanent delegate
//! can empty any account of that mint, and no program can stop it. It is not a
//! bug in the token; it is how a regulated issuer keeps the power to claw back
//! and pause. Every real xStock has it. So it is a TRUST decision, and it is
//! made once per mint by the protocol authority (`MintApproval`), not silently
//! by whoever creates a market. Such a mint is `IssuerTrusted`.
//!
//! Verdicts read the extension's CONTENTS, not its presence. An xStock carries
//! a `TransferHook` extension naming no program, and a `DefaultAccountState` of
//! `Initialized`; both are inert, and refusing them by name would refuse the
//! asset class for nothing.
//!
//! The TLV region is walked by type number, not through the `spl-token-2022`
//! crate. The crate pinned by Anchor 0.30.1 (3.0.5) predates `ScaledUiAmount`
//! and `Pausable` and returns an error for a mint carrying an extension it has
//! no name for — which is, again, every xStock. An unknown type number is
//! `Refused`: fail closed.
//!
//! Classic SPL Token mints have no extension region and are `Open`.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;

/// A mint's base state is 82 bytes; Token-2022 pads it to the token-account
/// length so the account-type byte sits at the same offset in both.
const BASE_MINT_LEN: usize = 82;
const ACCOUNT_TYPE_OFFSET: usize = 165;
const ACCOUNT_TYPE_MINT: u8 = 1;
const TLV_START: usize = 166;

// Extension type numbers, from `spl_token_2022::extension::ExtensionType`.
const TRANSFER_FEE_CONFIG: u16 = 1;
const MINT_CLOSE_AUTHORITY: u16 = 3;
const CONFIDENTIAL_TRANSFER_MINT: u16 = 4;
const DEFAULT_ACCOUNT_STATE: u16 = 6;
const NON_TRANSFERABLE: u16 = 9;
const INTEREST_BEARING_CONFIG: u16 = 10;
const PERMANENT_DELEGATE: u16 = 12;
const TRANSFER_HOOK: u16 = 14;
const CONFIDENTIAL_TRANSFER_FEE_CONFIG: u16 = 16;
const METADATA_POINTER: u16 = 18;
const TOKEN_METADATA: u16 = 19;
const GROUP_POINTER: u16 = 20;
const TOKEN_GROUP: u16 = 21;
const GROUP_MEMBER_POINTER: u16 = 22;
const TOKEN_GROUP_MEMBER: u16 = 23;
const SCALED_UI_AMOUNT: u16 = 25;
const PAUSABLE: u16 = 26;

const ACCOUNT_STATE_FROZEN: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Anyone may create a market quoted in this mint.
    Open,
    /// Custodiable, but its issuer can move or stall what the vault holds.
    /// Needs a `MintApproval`.
    IssuerTrusted,
    Refused,
}

fn is_set(key: &[u8]) -> bool {
    key.iter().any(|b| *b != 0)
}

/// One extension's verdict, from its type and its bytes.
fn judge(ty: u16, value: &[u8]) -> Verdict {
    use Verdict::*;
    match ty {
        // 1. A deposit of `n` arrives as less than `n`. Handled by crediting
        //    arrivals (`pull`), so the vault never believes more than it holds.
        //    The authority can raise the rate at will: an issuer power.
        TRANSFER_FEE_CONFIG => match value {
            v if v.len() == 108 => if is_set(&v[..32]) { IssuerTrusted } else { Open },
            _ => Refused,
        },
        // Confidential fees cannot be observed by the vault at all.
        CONFIDENTIAL_TRANSFER_FEE_CONFIG => Refused,

        // 2. With a program named, every transfer CPIs into it, needs accounts
        //    this protocol does not pass, and can be failed at will. With only
        //    an AUTHORITY named, no code runs today but the issuer can name a
        //    program later and stall every payout: an issuer power.
        //    Layout: authority (32) + program id (32).
        TRANSFER_HOOK => match value {
            v if v.len() == 64 && is_set(&v[32..]) => Refused,
            v if v.len() == 64 && is_set(&v[..32]) => IssuerTrusted,
            v if v.len() == 64 => Open,
            _ => Refused,
        },

        // 3. The vault can never pay out / opens frozen.
        NON_TRANSFERABLE => Refused,
        DEFAULT_ACCOUNT_STATE => match value {
            [state] if *state != ACCOUNT_STATE_FROZEN => Open,
            _ => Refused,
        },

        // 4. Issuer powers over every holder, the vault included.
        PERMANENT_DELEGATE => match value {
            v if v.len() == 32 => if is_set(v) { IssuerTrusted } else { Open },
            _ => Refused,
        },
        // authority (32) + paused (1). An issuer who can pause can stall
        // settlement for as long as they like.
        PAUSABLE => match value {
            v if v.len() == 33 => if is_set(&v[..32]) { IssuerTrusted } else { Open },
            _ => Refused,
        },

        // Raw amounts are untouched by both; only the DISPLAYED amount scales.
        // `ScaledUiAmount` is how an xStock survives a split, so it is allowed,
        // and every ladder amount is in raw units — a UI must apply the
        // multiplier. `InterestBearingConfig` is the same mechanism on a
        // clock; no asset worth quoting uses it, so it stays refused until one
        // does and someone has thought about what "1 share pays 1 unit" means
        // when the unit's displayed value drifts continuously.
        SCALED_UI_AMOUNT => Open,
        INTEREST_BEARING_CONFIG => Refused,

        // Confidential balances live in an extension the ACCOUNT must opt into.
        // The vault never does, so nothing can reach it confidentially and its
        // plain `amount` is the whole truth.
        CONFIDENTIAL_TRANSFER_MINT => Open,

        // Descriptive.
        MINT_CLOSE_AUTHORITY | METADATA_POINTER | TOKEN_METADATA | GROUP_POINTER | TOKEN_GROUP
        | GROUP_MEMBER_POINTER | TOKEN_GROUP_MEMBER => Open,

        _ => Refused,
    }
}

/// A mint's transfer fee at `epoch`: (basis points, maximum fee per transfer).
/// `None` when the mint takes no fee. The config holds two schedules — the
/// one in force and the one becoming so — and the epoch picks between them.
pub fn transfer_fee(data: &[u8], epoch: u64) -> Option<(u16, u64)> {
    if data.len() < TLV_START || data[ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_MINT {
        return None;
    }
    let mut at = TLV_START;
    while at + 4 <= data.len() {
        let ty = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = u16::from_le_bytes([data[at + 2], data[at + 3]]) as usize;
        if ty == 0 {
            break;
        }
        let v = data.get(at + 4..at + 4 + len)?;
        if ty == TRANSFER_FEE_CONFIG && v.len() == 108 {
            // authority 32 · withdraw authority 32 · withheld 8 · older {epoch 8, max 8, bps 2} · newer {…}
            let sched = |o: usize| {
                let ep = u64::from_le_bytes(v[o..o + 8].try_into().unwrap());
                let max = u64::from_le_bytes(v[o + 8..o + 16].try_into().unwrap());
                let bps = u16::from_le_bytes([v[o + 16], v[o + 17]]);
                (ep, bps, max)
            };
            let (older, newer) = (sched(72), sched(90));
            let (_, bps, max) = if epoch >= newer.0 { newer } else { older };
            return if bps == 0 { None } else { Some((bps, max)) };
        }
        at += 4 + len;
    }
    None
}

/// The smallest amount to send so that at least `net` arrives after a fee of
/// `bps` capped at `max_fee`. Exact inverse of Token-2022's own rounding
/// (fee = ceil(gross · bps / 10_000), then min with the cap).
pub fn gross_for(net: u64, fee: Option<(u16, u64)>) -> Option<u64> {
    let Some((bps, max_fee)) = fee else { return Some(net) };
    if bps >= 10_000 {
        return None;
    }
    let bps = bps as u128;
    // gross ≥ net · 10_000 / (10_000 − bps), rounded up
    let mut gross = ((net as u128 * 10_000 + (10_000 - bps) - 1) / (10_000 - bps)) as u64;
    let fee_at = |g: u64| (((g as u128 * bps + 9_999) / 10_000) as u64).min(max_fee);
    // Past the cap the fee is flat, so the gross is just net + cap — and that
    // is less than the uncapped estimate exactly when the cap binds.
    if let Some(capped) = net.checked_add(max_fee) {
        if capped < gross && fee_at(capped) == max_fee {
            gross = capped;
        }
    }
    // Rounding can leave the estimate a unit short; never more than a few.
    while gross.checked_sub(fee_at(gross))? < net {
        gross = gross.checked_add(1)?;
    }
    Some(gross)
}

/// Classify a mint account's raw data.
pub fn classify(data: &[u8]) -> Verdict {
    if data.len() == BASE_MINT_LEN {
        return Verdict::Open; // classic SPL Token, or Token-2022 with nothing on it
    }
    if data.len() < TLV_START || data[ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_MINT {
        return Verdict::Refused;
    }
    let mut verdict = Verdict::Open;
    let mut at = TLV_START;
    while at + 4 <= data.len() {
        let ty = u16::from_le_bytes([data[at], data[at + 1]]);
        let len = u16::from_le_bytes([data[at + 2], data[at + 3]]) as usize;
        if ty == 0 {
            break; // uninitialized tail
        }
        let Some(value) = data.get(at + 4..at + 4 + len) else {
            return Verdict::Refused; // a length that runs off the account
        };
        match judge(ty, value) {
            Verdict::Refused => {
                msg!("refusing mint: extension {} is not custodiable", ty);
                return Verdict::Refused;
            }
            Verdict::IssuerTrusted => verdict = Verdict::IssuerTrusted,
            Verdict::Open => {}
        }
        at += 4 + len;
    }
    verdict
}

/// The permissionless bar: `Open` only.
pub fn assert_mint_is_custodiable(mint: &AccountInfo) -> Result<()> {
    assert_mint_allowed(mint, false)
}

/// `approved`: whether the protocol authority has accepted this mint's issuer.
pub fn assert_mint_allowed(mint: &AccountInfo, approved: bool) -> Result<()> {
    let data = mint.try_borrow_data()?;
    match classify(&data) {
        Verdict::Open => Ok(()),
        Verdict::IssuerTrusted if approved => Ok(()),
        Verdict::IssuerTrusted => err!(SoothCoreError::MintNeedsApproval),
        Verdict::Refused => err!(SoothCoreError::UnsupportedMintExtension),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// NVDAx, `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, read from mainnet
    /// on 2026-09-22. 679 bytes, 8 decimals, eight extensions.
    fn nvdax() -> Vec<u8> {
        let hex = include_str!("../tests-fixtures/nvdax-mint.hex");
        (0..hex.len() / 2).map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap()).collect()
    }

    fn mint_with(exts: &[(u16, &[u8])]) -> Vec<u8> {
        let mut d = vec![0u8; TLV_START];
        d[ACCOUNT_TYPE_OFFSET] = ACCOUNT_TYPE_MINT;
        for (ty, value) in exts {
            d.extend_from_slice(&ty.to_le_bytes());
            d.extend_from_slice(&(value.len() as u16).to_le_bytes());
            d.extend_from_slice(value);
        }
        d
    }

    #[test]
    fn a_real_xstock_is_custodiable_but_only_on_the_authoritys_say_so() {
        let d = nvdax();
        assert_eq!(d.len(), 679);
        assert_eq!(d[44], 8, "decimals");
        assert_eq!(classify(&d), Verdict::IssuerTrusted);
    }

    #[test]
    fn a_classic_mint_is_open() {
        assert_eq!(classify(&[0u8; BASE_MINT_LEN]), Verdict::Open);
        assert_eq!(classify(&mint_with(&[])), Verdict::Open);
        assert_eq!(classify(&mint_with(&[(TOKEN_METADATA, &[7u8; 90]), (METADATA_POINTER, &[1u8; 64])])), Verdict::Open);
    }

    /// $STOOK, `GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu`, read from mainnet
    /// on 2026-09-22: 6 decimals, 1% transfer fee set by StonkFun, metadata.
    fn stook() -> Vec<u8> {
        let hex = include_str!("../tests-fixtures/stook-mint.hex");
        (0..hex.len() / 2).map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn stook_itself_is_custodiable_with_its_fee_read_correctly() {
        let d = stook();
        assert_eq!(d.len(), 516);
        assert_eq!(d[44], 6);
        assert_eq!(classify(&d), Verdict::IssuerTrusted, "the fee authority can change the rate");
        assert_eq!(transfer_fee(&d, 1040), Some((100, 1_000_000_000_000_000)));
        assert_eq!(transfer_fee(&d, 5_000), Some((100, 1_000_000_000_000_000)));
        assert_eq!(transfer_fee(&nvdax(), 1040), None, "no fee extension at all");
    }

    #[test]
    fn the_gross_sent_lands_exactly_the_net_needed() {
        // 1%: token-2022 takes ceil(gross/100)
        let fee = Some((100u16, u64::MAX));
        for net in [1u64, 99, 100, 101, 12_345, 1_000_000, 987_654_321, 10u64.pow(15)] {
            let g = gross_for(net, fee).unwrap();
            let taken = (g as u128 * 100 + 9_999) / 10_000;
            assert!(g as u128 - taken >= net as u128, "net {net}: gross {g} lands {}", g as u128 - taken);
            let g1 = g - 1;
            let taken1 = (g1 as u128 * 100 + 9_999) / 10_000;
            assert!((g1 as u128 - taken1) < net as u128, "net {net}: {g} is not the smallest");
        }
        // a capped fee: past the cap the gross is net + cap, not net / 0.99
        assert_eq!(gross_for(1_000_000, Some((100, 500))), Some(1_000_500));
        assert_eq!(gross_for(1_000, None), Some(1_000));
        assert_eq!(gross_for(1_000, Some((10_000, u64::MAX))), None, "a 100% fee cannot be paid through");
    }

    #[test]
    fn what_breaks_the_accounting_is_refused_whatever_it_contains() {
        // a fee whose authority is nobody is just a rate; with an authority it is a power
        assert_eq!(classify(&mint_with(&[(TRANSFER_FEE_CONFIG, &[0u8; 108])])), Verdict::Open);
        assert_eq!(classify(&mint_with(&[(TRANSFER_FEE_CONFIG, &[9u8; 108])])), Verdict::IssuerTrusted);
        assert_eq!(classify(&mint_with(&[(CONFIDENTIAL_TRANSFER_FEE_CONFIG, &[0u8; 64])])), Verdict::Refused);
        // 3. the vault can pay out
        assert_eq!(classify(&mint_with(&[(NON_TRANSFERABLE, &[])])), Verdict::Refused);
        assert_eq!(classify(&mint_with(&[(INTEREST_BEARING_CONFIG, &[0u8; 52])])), Verdict::Refused);
    }

    #[test]
    fn a_hook_is_judged_by_whether_it_names_a_program() {
        let mut hook = [0u8; 64];
        assert_eq!(classify(&mint_with(&[(TRANSFER_HOOK, &hook)])), Verdict::Open, "inert");
        hook[0] = 1; // an authority who could name one later
        assert_eq!(classify(&mint_with(&[(TRANSFER_HOOK, &hook)])), Verdict::IssuerTrusted);
        hook[40] = 1; // a program: code runs on every transfer
        assert_eq!(classify(&mint_with(&[(TRANSFER_HOOK, &hook)])), Verdict::Refused);
    }

    #[test]
    fn a_default_state_is_judged_by_whether_it_is_frozen() {
        assert_eq!(classify(&mint_with(&[(DEFAULT_ACCOUNT_STATE, &[1])])), Verdict::Open);
        assert_eq!(classify(&mint_with(&[(DEFAULT_ACCOUNT_STATE, &[2])])), Verdict::Refused);
    }

    #[test]
    fn issuer_powers_need_trust_only_when_someone_holds_them() {
        assert_eq!(classify(&mint_with(&[(PERMANENT_DELEGATE, &[0u8; 32])])), Verdict::Open);
        assert_eq!(classify(&mint_with(&[(PERMANENT_DELEGATE, &[9u8; 32])])), Verdict::IssuerTrusted);
        assert_eq!(classify(&mint_with(&[(PAUSABLE, &[0u8; 33])])), Verdict::Open);
        assert_eq!(classify(&mint_with(&[(PAUSABLE, &[9u8; 33])])), Verdict::IssuerTrusted);
        // and one refusal outweighs any amount of trust
        assert_eq!(
            classify(&mint_with(&[(PERMANENT_DELEGATE, &[9u8; 32]), (NON_TRANSFERABLE, &[])])),
            Verdict::Refused
        );
    }

    #[test]
    fn anything_unrecognised_or_malformed_fails_closed() {
        assert_eq!(classify(&mint_with(&[(999, &[0u8; 4])])), Verdict::Refused, "an extension from the future");
        assert_eq!(classify(&mint_with(&[(PERMANENT_DELEGATE, &[9u8; 31])])), Verdict::Refused, "wrong size");
        let mut d = mint_with(&[]);
        d.extend_from_slice(&[18, 0, 0xFF, 0x7F]); // a length that runs off the end
        assert_eq!(classify(&d), Verdict::Refused);
        let mut account = mint_with(&[]);
        account[ACCOUNT_TYPE_OFFSET] = 2; // a token ACCOUNT, not a mint
        account.push(0);
        assert_eq!(classify(&account), Verdict::Refused);
        assert_eq!(classify(&[0u8; 40]), Verdict::Refused);
    }
}

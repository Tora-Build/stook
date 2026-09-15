//! Stook — parimutuel price prediction.
//!
//! You draw a line where you think an asset lands; everyone close to it splits
//! the pot. No curve, no order book, no liquidity provider: the stake is the
//! liquidity, which is why a market is tradeable from its first participant
//! rather than from its first sponsor.
//!
//! See `docs/architecture.md` for what that costs — no early exit, late money
//! diluting early money, and a rake instead of a fee split — and why it was
//! chosen anyway.

use anchor_lang::prelude::*;

pub mod payout;
pub mod state;

pub use state::*;

declare_id!("LEDKe6vWgQeZQQsxNUXhK3UMxmZLcb2ZDxLuTGE3pw1");

#[program]
pub mod stook {
    use super::*;

    /// Open a market on an asset, a settlement time and a price band.
    pub fn create_market(_ctx: Context<CreateMarket>) -> Result<()> {
        err!(StookError::NotImplemented)
    }

    /// Stake behind a price. Called again, it adds to an existing stake rather
    /// than opening a second account.
    pub fn predict(_ctx: Context<Predict>) -> Result<()> {
        err!(StookError::NotImplemented)
    }

    /// Read the oracle, map the price to a band, cache the winning pool.
    pub fn settle(_ctx: Context<Settle>) -> Result<()> {
        err!(StookError::NotImplemented)
    }

    /// Pay a winner, once.
    pub fn claim(_ctx: Context<Claim>) -> Result<()> {
        err!(StookError::NotImplemented)
    }
}

#[derive(Accounts)]
pub struct CreateMarket {}

#[derive(Accounts)]
pub struct Predict {}

#[derive(Accounts)]
pub struct Settle {}

#[derive(Accounts)]
pub struct Claim {}

#[error_code]
pub enum StookError {
    #[msg("Not implemented")]
    NotImplemented,
    #[msg("Market is not accepting predictions")]
    NotAccepting,
    #[msg("Market has already been settled")]
    AlreadySettled,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Quote mint charges a transfer fee, which the pot cannot account for")]
    TransferFeeMintUnsupported,
    #[msg("Oracle price is stale or unavailable")]
    OracleUnavailable,
}

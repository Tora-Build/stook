//! The one protocol-wide account: who administers the deployment, where its
//! fee share lands, and whether it is paused.
//!
//! Fee rates are per market (`Ladder::fee_bps`) and the split is fixed in
//! code (`instructions::ladder::split_fee`), so there is nothing here for an
//! authority to tune trade by trade — the powers are pause, treasury, and
//! handing over.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";

#[account]
#[derive(Debug)]
pub struct ProtocolConfig {
    /// May pause, set the treasury, approve quote mints and nominate a
    /// successor.
    pub authority: Pubkey,
    /// Nominated successor; `Pubkey::default()` when none. Takes over only by
    /// signing `accept_authority`, so a typo cannot hand the protocol to nobody.
    pub pending_authority: Pubkey,
    /// Wallet whose token accounts receive the protocol's share of fees.
    pub treasury: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub _reserved: [u8; 30],
}

impl ProtocolConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 1 + 30;
}

pub fn require_not_paused(config: &ProtocolConfig) -> Result<()> {
    require!(!config.paused, SoothCoreError::ProtocolPaused);
    Ok(())
}

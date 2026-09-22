//! Protocol-level events. Market events live beside their instructions in
//! `instructions/ladder.rs`.

use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct ProtocolPausedEvent {
    pub authority: Pubkey,
    pub paused: bool,
}

#[event]
pub struct TreasuryChanged {
    pub authority: Pubkey,
    pub treasury: Pubkey,
}

#[event]
pub struct AuthorityTransferStarted {
    pub authority: Pubkey,
    pub nominee: Pubkey,
}

#[event]
pub struct AuthorityTransferAccepted {
    pub previous: Pubkey,
    pub authority: Pubkey,
}

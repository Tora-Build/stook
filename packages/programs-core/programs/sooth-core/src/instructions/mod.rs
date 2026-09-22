//! Instruction handlers. Anchor's `#[program]` macro needs every
//! `#[derive(Accounts)]` reachable at `crate::*`, hence the glob re-exports.

#![allow(ambiguous_glob_reexports)]

pub mod ladder;
pub mod protocol;

pub use ladder::*;
pub use protocol::*;

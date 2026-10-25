//! Instruction handlers. Anchor's `#[program]` macro needs every
//! `#[derive(Accounts)]` reachable at `crate::*`, hence the glob re-exports.

#![allow(ambiguous_glob_reexports)]

pub mod house;
pub mod ladder;
pub mod listing;
pub mod protocol;
pub mod series;

pub use house::*;
pub use ladder::*;
pub use listing::*;
pub use protocol::*;
pub use series::*;

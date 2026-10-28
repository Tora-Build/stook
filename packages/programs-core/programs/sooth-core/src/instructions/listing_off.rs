//! Listing left out (feature `no-listing`): a smaller program for a deploy
//! that serves the street's own coins only. Anchor's `#[program]` still
//! dispatches every instruction, so each keeps its name with a one-account
//! context and refuses; the real checks (listing.rs) are not built.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ListAnchorArgs {
    pub feed_id: [u8; 32],
    pub clock: u8,
    pub close_secs: u32,
    pub active: bool,
}

macro_rules! off {
    ($name:ident, $handler:ident $(, $arg:ident : $ty:ty)*) => {
        #[derive(Accounts)]
        pub struct $name<'info> {
            pub signer: Signer<'info>,
        }
        pub fn $handler(_ctx: Context<$name> $(, $arg: $ty)*) -> Result<()> {
            err!(SoothCoreError::ListAnchorInactive)
        }
    };
}

off!(ListAnchorSet, list_anchor_set_handler, _args: ListAnchorArgs);
off!(ListFeeSet, list_fee_set_handler, _lamports: u64);
off!(CoinList, coin_list_handler, _seed: u64, _max_gross: u64);
off!(CoinActivate, coin_activate_handler);
off!(CoinReject, coin_reject_handler);

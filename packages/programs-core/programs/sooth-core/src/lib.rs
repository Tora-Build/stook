//! `sooth_core` — Stook's program: price-ladder prediction markets.
//!
//! One Anchor program. A market is a 64-bin LMSR over log-spaced price bands
//! (`math::ladder`), funded by liquidity tranches that may join at any time
//! before lock, and settled by a Pyth price read with no human in the loop
//! (`oracle`). Markets quote in classic SPL or Token-2022 (`token_guard`).
//!
//! The name and the program's frame — allocator, config, errors — are
//! inherited from Sooth's `sooth_core`; the market engine is not.

#![allow(clippy::result_large_err)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");

// ── 256 KB bump allocator ────────────────────────────────────────────────
//
// Solana's default allocator hardcodes a 32 KB heap and never frees. This
// mirrors solana_program's own BumpAllocator (down-bumping, never frees) over
// a 256 KB region, the maximum `request_heap_frame` permits. The default
// allocator is suppressed by the `custom-heap` feature.
//
// The ladder's paths allocate little — Anchor's `Box<Account<…>>`
// deserialization and the token CPIs, a few KB — and would fit the default
// heap. The frame is kept because the SDK and every test already send it, and
// a program that stopped needing it would still be sent it at no cost (8 CU
// per extra 32 KB).
//
// ⚠️ CALLER CONTRACT: every transaction must prepend
// `ComputeBudgetInstruction::request_heap_frame(256 * 1024)`. This allocator
// hands out addresses from the TOP of that region, so without the frame the
// first allocation points outside mapped memory and the program aborts with
// "Access violation in heap section". The mapped size cannot be queried at
// runtime, so this cannot be detected and reported nicely. The SDK's
// `stook.withHeap` prepends it.
#[cfg(all(feature = "custom-heap", target_os = "solana"))]
#[global_allocator]
static SOOTH_CORE_ALLOC: BumpAllocator256 = BumpAllocator256;

/// Heap size this program's allocator assumes, and therefore the exact value
/// callers must pass to `request_heap_frame`.
pub const SOOTH_CORE_HEAP_LEN: usize = 256 * 1024;

#[cfg(all(feature = "custom-heap", target_os = "solana"))]
struct BumpAllocator256;

#[cfg(all(feature = "custom-heap", target_os = "solana"))]
unsafe impl core::alloc::GlobalAlloc for BumpAllocator256 {
    #[inline]
    unsafe fn alloc(&self, layout: core::alloc::Layout) -> *mut u8 {
        const HEAP_START: usize = 0x3_0000_0000;
        // The first machine word of the region holds the bump cursor.
        let pos_ptr = HEAP_START as *mut usize;
        let mut pos = *pos_ptr;
        if pos == 0 {
            pos = HEAP_START + SOOTH_CORE_HEAP_LEN;
        }
        pos = pos.saturating_sub(layout.size());
        pos &= !(layout.align().wrapping_sub(1));
        // Refuse to hand back the cursor slot itself.
        if pos < HEAP_START + core::mem::size_of::<*mut u8>() {
            return core::ptr::null_mut();
        }
        *pos_ptr = pos;
        pos as *mut u8
    }

    #[inline]
    unsafe fn dealloc(&self, _: *mut u8, _: core::alloc::Layout) {}
}

pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;
pub mod token_guard;

use instructions::*;

#[program]
pub mod sooth_core {
    use super::*;

    // ── Protocol ─────────────────────────────────────────────────────────────

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, treasury: Pubkey) -> Result<()> {
        protocol::initialize_handler(ctx, treasury)
    }

    /// Circuit breaker: stops trading, liquidity and market creation.
    /// Settlement, redemption and claims keep working — a pause must never
    /// hold anyone's money.
    pub fn set_paused(ctx: Context<Administer>, paused: bool) -> Result<()> {
        protocol::set_paused_handler(ctx, paused)
    }

    pub fn set_treasury(ctx: Context<Administer>, treasury: Pubkey) -> Result<()> {
        protocol::set_treasury_handler(ctx, treasury)
    }

    /// Nominate a successor; nothing moves until they sign `accept_authority`.
    /// The default pubkey withdraws a nomination.
    pub fn transfer_authority(ctx: Context<Administer>, nominee: Pubkey) -> Result<()> {
        protocol::transfer_authority_handler(ctx, nominee)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        protocol::accept_authority_handler(ctx)
    }

    // ── Quote mints ──────────────────────────────────────────────────────────

    /// Accept the issuer of a mint that `token_guard` classes as
    /// issuer-trusted, so markets may be quoted in it. Protocol authority only.
    pub fn approve_quote_mint(ctx: Context<ApproveQuoteMint>) -> Result<()> {
        ladder::approve_quote_mint_handler(ctx)
    }

    /// Withdraw that acceptance. Existing markets are unaffected.
    pub fn revoke_quote_mint(ctx: Context<RevokeQuoteMint>) -> Result<()> {
        ladder::revoke_quote_mint_handler(ctx)
    }

    // ── Markets ──────────────────────────────────────────────────────────────

    /// Create a price ladder; the creator's seed is its first tranche.
    pub fn ladder_create(ctx: Context<LadderCreate>, args: LadderCreateArgs) -> Result<()> {
        ladder::create_handler(ctx, args)
    }

    /// Open a seeded ladder: centre its grid on the Pyth price.
    /// Permissionless — nothing about opening is a choice.
    pub fn ladder_open(ctx: Context<LadderOpen>) -> Result<()> {
        ladder::open_handler(ctx)
    }

    /// Buy or sell a band or a tent.
    pub fn ladder_trade(ctx: Context<LadderTrade>, args: LadderTradeArgs) -> Result<()> {
        ladder::trade_handler(ctx, args)
    }

    /// Add liquidity as a new tranche, any time before lock, at the prices
    /// the LP named.
    pub fn ladder_lp_join(ctx: Context<LadderLpJoin>, args: LadderLpJoinArgs) -> Result<()> {
        ladder::lp_join_handler(ctx, args)
    }

    /// Settle from the one Pyth update that is the price at `settles_at`.
    /// Permissionless: the rule picks the update, not the caller.
    pub fn ladder_settle(ctx: Context<LadderSettle>) -> Result<()> {
        ladder::settle_handler(ctx)
    }

    /// Void a ladder that never opened, or whose settlement price never came.
    pub fn ladder_void(ctx: Context<LadderVoid>) -> Result<()> {
        ladder::void_handler(ctx)
    }

    /// Collect a position: its payout if settled, its cost basis if void. The
    /// owner at any time; anyone, to the owner, 30 days after the close.
    pub fn ladder_redeem(ctx: Context<LadderRedeem>) -> Result<()> {
        ladder::redeem_handler(ctx)
    }

    /// Collect an LP stake's share of what the market left. The owner at any
    /// time; anyone, to the owner, 30 days after the close.
    pub fn ladder_claim_lp(ctx: Context<LadderClaimLp>) -> Result<()> {
        ladder::claim_lp_handler(ctx)
    }

    /// Send accrued creator and protocol fees to their fixed destinations.
    pub fn ladder_collect_fees(ctx: Context<LadderCollectFees>) -> Result<()> {
        ladder::collect_fees_handler(ctx)
    }

    /// Close a finished round's position that is owed nothing; its rent
    /// goes to its owner. Permissionless.
    pub fn ladder_sweep(ctx: Context<LadderSweep>) -> Result<()> {
        ladder::sweep_handler(ctx)
    }

    /// Close a finished round once everything is paid: dust to the treasury,
    /// rent to whoever funded it. Permissionless.
    pub fn ladder_close(ctx: Context<LadderClose>) -> Result<()> {
        ladder::close_handler(ctx)
    }

    // ── Series ───────────────────────────────────────────────────────────────

    /// Open a coin's series of rounds. Protocol authority.
    pub fn series_create(ctx: Context<SeriesCreate>, args: SeriesCreateArgs) -> Result<()> {
        series::series_create_handler(ctx, args)
    }

    /// Pause or resume a series' new rounds. Protocol authority. There is no
    /// way to set a series' volatility.
    pub fn series_set(ctx: Context<SeriesSet>, active: bool) -> Result<()> {
        series::series_set_handler(ctx, active)
    }

    /// Teach a series one day's close from Pyth, under the settlement rule.
    /// Permissionless.
    pub fn series_observe(ctx: Context<SeriesObserve>, index: u32) -> Result<()> {
        series::series_observe_handler(ctx, index)
    }
}

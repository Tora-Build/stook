# programs-core

The Anchor program behind Stook: `sooth_core`, program id
`55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353`.

```
programs/sooth-core/src/
├── lib.rs              # declare_id!, the 256 KB bump allocator, 17 handlers
├── error.rs            # SoothCoreError — append-only
├── events.rs           # protocol events; market events sit beside their handlers
├── oracle.rs           # Pyth PriceUpdateV2 parser and the settlement-instant rule
├── token_guard.rs      # which Token-2022 mints a vault may hold, and on whose say-so
├── instructions/
│   ├── ladder.rs       # the market: create, open, trade, LP join, settle, void,
│   │                   #   redeem, LP claim, fees, mint approval
│   └── protocol.rs     # initialise, pause, treasury, authority hand-over
├── state/
│   ├── ladder.rs       # Ladder (zero-copy, 1,880 B), LadderPosition, LadderTranche, MintApproval
│   └── protocol_config.rs
└── math/
    ├── wad.rs          # WAD fixed point, exact to 2^96 divisors
    ├── lmsr.rs         # exp_wad, ln_wad
    ├── lmsr_n.rs       # N-outcome LMSR, the reference the ladder is tested against
    └── ladder.rs       # the 64-bin ladder: shapes, trades, tranches
```

## Instructions

| Group | Instructions |
| ----- | ------------ |
| Protocol | `initialize_protocol`, `set_paused`, `set_treasury`, `transfer_authority`, `accept_authority` |
| Quote mints | `approve_quote_mint`, `revoke_quote_mint` |
| Market | `ladder_create`, `ladder_open`, `ladder_trade`, `ladder_lp_join`, `ladder_settle`, `ladder_void` |
| Collection | `ladder_redeem`, `ladder_claim_lp`, `ladder_collect_fees` |

Everything a market does after creation is permissionless: opening, settling
and voiding are clock and oracle reads that anyone may trigger.

## The one thing every caller must know

**Prepend `ComputeBudgetInstruction::request_heap_frame(256 * 1024)` to every
transaction.** The program installs a 256 KB bump allocator and the runtime
maps that region only when asked. Without the frame the first allocation
aborts with "Access violation in heap section". `stook.withHeap` in the SDK
does it.

## Build and test

```bash
cargo test -p sooth_core --lib                                    # 89 unit tests
cargo build-sbf --manifest-path packages/programs-core/programs/sooth-core/Cargo.toml
pnpm -F @sooth/sdk-solana test                                    # LiteSVM, real binary
```

`--features mainnet` raises the oracle bar to fully verified Pyth updates only.

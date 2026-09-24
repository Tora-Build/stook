# programs-core

The Anchor program behind Stook: `sooth_core`, program id
`55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353`.

```
programs/sooth-core/src/
├── lib.rs              # declare_id!, the 256 KB bump allocator, 21 handlers
├── error.rs            # SoothCoreError — append-only
├── events.rs           # protocol events; market events sit beside their handlers
├── oracle.rs           # Pyth PriceUpdateV2 parser and the settlement-instant rule
├── token_guard.rs      # which Token-2022 mints a vault may hold, and on whose say-so
├── instructions/
│   ├── ladder.rs       # a round: create, open, trade, LP join, settle, void,
│   │                   #   redeem, LP claim, fees, sweep, close, mint approval
│   ├── series.rs       # a coin's series: create, pause, observe a close
│   └── protocol.rs     # initialise, pause, treasury, authority hand-over
├── state/
│   ├── ladder.rs       # Ladder (zero-copy, 1,928 B + 8 discriminator), LadderPosition,
│   │                   #   LadderTranche (1,152 B + 8), MintApproval
│   ├── series.rs       # Series (115 B + 8): the clock, and variance learned from closes
│   └── protocol_config.rs
└── math/
    ├── wad.rs          # WAD fixed point, exact to 2^96 divisors
    ├── lmsr.rs         # exp_wad, ln_wad
    ├── lmsr_n.rs       # N-outcome LMSR, the reference the ladder is tested against
    ├── calendar.rs     # civil dates, weekdays, the New York close through daylight saving
    └── ladder.rs       # the 64-bin ladder: shapes, trades, tranches, band width
```

## Instructions

| Group | Instructions |
| ----- | ------------ |
| Protocol | `initialize_protocol`, `set_paused`, `set_treasury`, `transfer_authority`, `accept_authority` |
| Quote mints | `approve_quote_mint`, `revoke_quote_mint` |
| Series | `series_create`, `series_set` (pause only), `series_observe` |
| Round | `ladder_create`, `ladder_open`, `ladder_trade`, `ladder_lp_join`, `ladder_settle`, `ladder_void` |
| Collection | `ladder_redeem`, `ladder_claim_lp`, `ladder_collect_fees`, `ladder_sweep`, `ladder_close` |

The protocol authority creates and pauses series; everything after that is
permissionless. Anyone may fund a day's round (`ladder_create`, up to 31 days
ahead), teach a series a close, and open, settle, void, sweep and close
rounds: each is a clock and oracle read that anyone may trigger.

## The one thing every caller must know

**Prepend `ComputeBudgetInstruction::request_heap_frame(256 * 1024)` to every
transaction.** The program installs a 256 KB bump allocator and the runtime
maps that region only when asked. Without the frame the first allocation
aborts with "Access violation in heap section". `stook.withHeap` in the SDK
does it.

## Build and test

```bash
cargo test -p sooth_core --lib                                    # over 100 unit tests
cargo build-sbf --manifest-path packages/programs-core/programs/sooth-core/Cargo.toml
pnpm -F @sooth/sdk-solana test                                    # LiteSVM, real binary
```

`--features mainnet` raises the oracle bar to fully verified Pyth updates only.

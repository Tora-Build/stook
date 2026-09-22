# @sooth/sdk-solana

Stook's client library. ESM, Node ≥ 20, no Anchor client — every instruction
is hand-encoded, so a bundle never loads the IDL.

```ts
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
```

## What it does

**Quotes, exact.** `stook.quoteTrade` returns the base-unit amount
`ladder_trade` will charge or pay, fee included, and the curve after the trade.
The end-to-end test sends every trade with its limit set to that quote exactly:
a port one unit off would fail it. `liquidityForDeposit`, `tranchePnl`,
`tranchePrincipal` and `trancheFees` do the same for liquidity.

**Reads.** `decodeLadder`, `decodeLadderPosition`, `decodeLadderTranche`;
`ladderFilters(status)` for `getProgramAccounts`; `classifyMint` says whether a
Token-2022 mint can quote a market, and why not.

**Builds.** One function per instruction — `createLadderIx`, `openLadderIx`,
`tradeLadderIx`, `joinLadderIx`, `settleLadderIx`, `voidLadderIx`,
`redeemLadderIx`, `claimLpIx`, `collectLadderFeesIx`, `approveQuoteMintIx`,
`revokeQuoteMintIx` — plus the PDA derivations they use. `withHeap(ixs)`
prepends the 256 KB heap request every `sooth_core` transaction must carry.

**Keeper.** `nextStep` says what a market is waiting for; `openProblem` and
`settlementProblem` say whether the program would accept a given Pyth update,
so a keeper never pays to post one that will be refused.

## Tests

```bash
pnpm -F @sooth/sdk-solana test
```

`ladder-e2e` and `ladder-token2022` run the real program binary on LiteSVM
(`cargo build-sbf` first, or point `STOOK_SO` at a `.so`). The Token-2022 run
uses a mainnet xStock mint's actual bytes (`tests/fixtures/nvdax-mint.hex`).

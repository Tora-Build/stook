# ladder-crank

Opens, settles and voids Stook ladders. Permissionless: the program decides
which price settles a market (`prev_publish_time < T <= publish_time`, the first
Pyth update at or after the settlement time), so it does not matter who runs
this or how many copies run.

```bash
pnpm -F @sooth/sdk-solana build
PYTH_API_KEY=… node src/index.mjs --plan    # what is each market waiting for?
PYTH_API_KEY=… node src/index.mjs --watch
```

## Status: not yet run against a chain

The decisions — which step a market needs, whether an update will be accepted —
live in the SDK (`src/ladder/crank.ts`) and are unit-tested. The I/O in
`src/index.mjs` has only been syntax-checked, because two things it needs do
not exist yet:

- a **Hermes API key** (Hermes has answered 401 without one since 2026-08-26);
- a **devnet deployment** of the program.

Expect to fix something in the Pyth-receiver wiring the first time it runs. In
particular, confirm the heap-frame request lands in the same transaction as
the consuming instruction when the receiver's builder splits a post across
transactions.

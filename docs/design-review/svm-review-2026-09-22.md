# Is Stook an EVM design on Solana? — three blind reviews, 2026-09-22

Three fresh agents, no shared context, each given the repo and one lens, asked
the same question: *is this an EVM contract transliterated onto Solana, and
where would an SVM-native design differ?* Their reports are summarised here
with what was done about each finding. Lens 1 = account model & parallelism,
lens 2 = compute & state layout, lens 3 = async settlement & liveness.

## Verdicts

| lens | verdict |
|---|---|
| accounts | **Not a transplant.** No global counter on the trade path, per-user state in rent-reclaimable PDAs, tranche snapshot chosen so a trade touches O(1) accounts, pull-oracle post-and-consume. The single 1,880 B market account is the right SVM unit for an LMSR — the scoring rule is one sum and cannot be sharded. |
| compute | **Structure SVM-native, arithmetic EVM.** Caching `exp(qᵢ/b)` so a trade is one exp + one ln is right. But WAD (1e18) fixed point forces a 128-bit division per multiply, and `exp`/`ln` did 26 divisions each. |
| liveness | **EVM bot habits.** Open and settle were permissionless in signature and keeper-only in practice; nothing paid the settler; losers could void with one click while winners could not settle. |

## Findings and outcomes

**Done today**

- *Division-free `exp_wad`/`ln_wad`* (compute #1). Binary Q0.64 series with constant reciprocals behind the same WAD interface; TS port rewritten op for op, e2e still bit-exact. Tent 63K→45K CU, 25-bin band 79K→62K, LP join 38K→24K, LP claim 40K→21K.
- *Settle bounty* (liveness #1). The settler takes half the protocol's fee share; a void pays nothing, so no trader prefers voiding.
- *Creator in market seeds* (accounts #2, liveness #4). Ends the slot squat: nobody can claim "NVDA Friday 16:00" for everyone with a 1-token seed and a 5% fee.
- *`LadderCreated/Opened/Voided` events* (accounts #3).
- *Clock skew at open* (liveness #5): a price up to 10 s ahead of the cluster clock is accepted.
- *Shape-sized compute request* (accounts #1, compute #7): 60K + 2K per bin touched, priority fee set in the app.

**Measured and declined**

- Splitting the market account (accounts #1): every trade must atomically touch curve, payout table, cash and fees; splitting adds accounts and CU for zero parallelism. At a 120K request, one market takes ~100 trades/s, far above any prediction market's history.
- f64 (compute #4): soft-float on SBF is slower than the integer series and risks determinism.
- Storing `qᵢ` or `ln wᵢ` instead of `wᵢ` (compute #5): 64 exps per trade.
- Off-chain compute with on-chain verify (compute #8): verifying costs what computing costs.

**Open, in priority order**

1. *Q64.64 weights* (compute #2): per-bin multiply hits the 256-bit path once a weight passes ~340; a 64-bin band on a grown market is 109K CU today. Binary fixed point would make it ~25K. M effort; devnet only so no migration.
2. *Series PDA / rolling rounds* (liveness #4): "NVDA hourly, forever, anyone creates the next round". M effort; also fixes mainnet discovery without `getProgramAccounts`.
3. *Lazy open* (liveness #2): open on the first trade from Pyth's push-oracle account instead of a keeper post. Blocked by cadence: the push oracle on devnet refreshes crypto every ~2 min and equities far less, so a 60 s freshness bar rarely passes. Would need the bar per feed class.
4. *Per-feed settlement gap* (liveness #3): 30 s is right for crypto; `Equity.Index.*` overnight may need more, and a conf interval that straddles two bins could pay both pro rata instead of voiding.
5. *Remove the 256 KB allocator* (compute #6): pure liability now; keep `withHeap` sending the frame for a release, then drop.
6. *Close empty markets* (liveness #6): reclaim the ladder's rent and sweep dust once nothing is owed.
7. *`emit_cpi!`* (accounts #3) when an indexer exists; not before.

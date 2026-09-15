# Architecture

## The decision this document exists to record

Stook is a **parimutuel** market. It is not the Sooth engine with a different
front end — there is no LMSR, no `b` subsidy, no LP token, no graduation and no
order book. That is a deliberate reversal, and the reasoning matters more than
the result.

The Sooth/Fan engine prices a market with a logarithmic market scoring rule,
which is the correct way to run a continuous two-sided venue. It also requires
someone to fund the curve before the first trade, and it discretises a
continuous question into outcomes you must define up front. Stook's question is
"where will this land", asked of an audience that has not arrived yet. For that
question, on a four-week clock, a pot beats a curve.

What is given up, stated once so nobody rediscovers it as a bug:

- **No early exit.** Stake is committed until settlement. An AMM lets you sell
  your view back; a pot does not.
- **Late money dilutes early money.** Someone staking a minute before close
  faces the same odds as someone who staked a week earlier and carried the risk
  longer. A time weight on payouts fixes it and is deliberately not in v1.
- **No LP business.** Revenue is a rake on the pot, not a fee split across
  curve, LPs, adjudicator and treasury.

## Continuous UI, bucketed state

A participant draws a line at any price. The program does not store that line.

Storing an exact prediction per participant would mean iterating every
prediction at settlement to compute the payout denominator, and that does not
fit in a transaction. So the market carries a fixed array of price buckets, and
a prediction is filed into the bucket containing it. Settlement is then O(N)
over the buckets rather than O(participants).

The UI stays continuous: the line is drawn anywhere, and the bucket it lands in
is shown as the band it commits to. The honesty requirement is that the band is
visible before the stake is confirmed — a participant must never believe they
committed to a finer price than the program recorded.

```
band:   <170   170-180  180-190  190-200   >200
pool:    4%      18%      47%      27%      4%
                          ^ your line, 186.40
```

## State

**Market** — one per (asset, settlement time).

| Field | Purpose |
| --- | --- |
| `asset` | What is being predicted. Identifies the oracle feed. |
| `quote_mint` | What is staked. USDC on mainnet. |
| `vault` | Holds the pot. PDA-owned token account. |
| `lo`, `hi`, `bucket_count` | The price band and its subdivision. |
| `bucket_stake[N]` | Staked per bucket. The crowd's distribution, live. |
| `pot` | Total staked. Equals the sum of `bucket_stake`. |
| `rake_bps` | Protocol's cut, taken at settlement, never from a loser's stake. |
| `opens_at`, `closes_at`, `settles_at` | Predictions accepted in `[opens_at, closes_at)`. |
| `status` | Open, Closed, Settled, Void. |
| `settled_bucket` | Written once, at settlement. |
| `winning_stake` | `bucket_stake[settled_bucket]`, cached so claims are O(1). |

**Prediction** — one per (market, participant). Seeds `[b"prediction", market,
owner]`.

| Field | Purpose |
| --- | --- |
| `market`, `owner` | Identity. |
| `bucket` | Which band was committed to. |
| `stake` | Quote-token base units staked. |
| `claimed` | Guards against double payout. |

A second prediction from the same wallet adds to the existing account rather
than creating another, so one participant occupies one account per market
regardless of how many times they stake. Changing bands is a separate
instruction, not an implicit consequence of staking again — moving someone's
existing money because they added to it is a surprise nobody wants.

## Payout

v1 is exact-bucket parimutuel:

```
payout = stake × (pot − rake) / winning_stake
```

If `winning_stake` is zero — nobody predicted the settled band — the market is
void and every stake is refundable in full. The rake is not taken from a void.

The accuracy variant, deliberately deferred: score each bucket by its distance
from the settled one under a kernel, and split by `stake × score` rather than
by membership. It is the better product (near-misses pay something, which is
what makes a prediction game feel fair) and it is one function plus an O(N) sum
at settlement. It is not in v1 because exact-bucket is the version whose
correctness is obvious on inspection.

## Settlement

The settled price comes from an oracle read at `settles_at`, mapped to a
bucket. Stook does not resolve by vote, committee or dispute: the question is
always "what was this number", and a number has a source.

Two failure modes have to be handled rather than assumed away:

- **The oracle is stale or absent at `settles_at`.** The market voids and
  refunds. It does not settle on a stale price, and it does not wait
  indefinitely holding everyone's money.
- **The settled price is outside `[lo, hi]`.** The outer buckets are unbounded
  by construction — the first is `< lo` and the last is `≥ hi` — so this cannot
  happen. The band chosen at creation affects resolution granularity, never
  whether the market can resolve.

## Token-2022

The quote mint must be held by the vault, and the assets worth predicting on
Solana — xStocks, and the stock-paired tokens launched against them — are
Token-2022, not classic SPL. So the vault paths use `token_interface` from the
start rather than being migrated later.

Mints carrying the transfer-fee extension are **refused at creation**. A pot
whose deposits silently arrive 3% short is a pot that cannot pay out what it
believes it holds, and supporting that correctly means fee-aware accounting on
every path. Refusing is the honest position until it is built.

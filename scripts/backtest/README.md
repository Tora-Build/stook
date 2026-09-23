# How wide a band, and what odds a round opens with

Two scripts replay every daily round over two years of hourly prices (BTC,
ETH, SOL, DOGE, ZEC) and three of market hours (SPY, GLD): 4,493 rounds.

- `explore.py` searches the rule in floating point: bell shape, how many
  bands an ordinary move spans, how deep the tails, how long the volatility
  memory.
- `validate.mjs` replays the chosen rule through the SDK functions that
  match the program to the unit (`bandWidth`, `prior`, `closeOf`) with the
  variance updated exactly as `Series::observe` does it. `results.txt` is its
  output.

Data: Yahoo hourly bars (`interval=60m&range=730d`), one `<SYMBOL>.json` of
`[unix, close]` per asset. Run with `python3 explore.py DIR` and
`node validate.mjs DIR`.

## The counterparty

Each round opens a day before its close on the price then. At the lock (an
hour before the close) one trader knows the price at the lock and moves the
market to where the close is likely to land from there, on a Gaussian belief.
The house's result is `b · ln(p_open[k] / q[k])` at the band `k` that
settles, before fees. This is a strongly informed trader, not the literal
worst: the third audit found a fat-tailed belief takes about 1.1 points more,
because a thin-tailed one occasionally hands the house a windfall.

Stock anchors are replayed on weekdays only, which is what their on-chain
series do (`CLOCK_NEW_YORK_WEEKDAYS`). Their hourly bars start on the half
hour, so the "price at the lock" the trader sees is really 30 minutes before
the close: that flatters the trader, not the house.

## Result (`results.txt`)

| rule | house per round | worst 5% | closes off the grid |
|---|---|---|---|
| flat, 1% bands | −74.5% | −99.5% | 0% |
| bell, one fixed band width per coin | −17.3% | −41.0% | 0.1% |
| **bell, band = σ/4 from on-chain volatility** | **−16.6%** | **−35.1%** | **0%** |

What is and is not significant (independent replay by the third audit,
bootstrap over rounds): the average gain over fixed widths (0.7 points) comes
from ZEC and GLD and is not significant on the other coins; the tail gain
(5.9 points on the worst 5%) and the gain in the weeks after a volatility
spike are. The rule's value is robustness when an anchor changes character,
and that it needs no per-coin table. Per coin it matches or beats the
hand-picked widths everywhere, and holds where they broke: when ZEC's volatility jumped, fixed
1% bands lost 71% in the worst 5% of rounds; volatility-sized bands, 35%.
Widths it picks: BTC 0.55%, ETH 0.90%, SOL 0.95%, DOGE 1.1%, ZEC 1.5%, SPY
0.19%, GLD 0.25%.

## What the search found

- **Calibration is what matters, not the curve's shape.** Measured per unit
  of depth (the break-even volume), flat costs 3.10 nats, any calibrated bell
  1.5 to 1.6. Gaussian vs Student-t, and the tail floor, move it by less than
  0.1.
- **A deeper tail floor only looks better per deposit** because the deposit
  buys less depth: less loss and less fee income alike. The shipped floor
  (1:1,100) gives the most depth per token for the same loss per depth.
- **Four bands per ordinary move.** Two leaves 10 tradeable bands, six pushes
  closes off the grid; four gives 18 and costs 1.54 nats against 1.42 for two.
- **Volatility memory:** a week (λ 0.90), two weeks (0.94) and a month (0.97)
  are within noise of each other. The program uses 0.94.

What the rule cannot remove: a round's price moves during its day, and a
market maker that quotes all day pays for that information. At −16.6% before
fees against a perfectly informed trader, the house needs trading volume of
roughly 190 times its depth per round to break even on fees alone against
that worst case. Real flow is not all perfectly informed at the lock; this is
the ceiling on the loss, not the expectation.

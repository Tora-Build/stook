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

Stock anchors are replayed on weekdays only, which is what the program's
weekday clock does (`CLOCK_NEW_YORK_WEEKDAYS`); mainnet stock series should
use it (the devnet series run every day on crypto stand-ins). Their hourly bars start on the half
hour, so the "price at the lock" the trader sees is really 30 minutes before
the close: that flatters the trader, not the house.

## Result (`results.txt`)

These runs predate the program's 0.2% band floor (`MIN_STEP_BPS`), so SPY
was replayed at 0.19% bands, just under what the program now allows. The
other coins' widths are above the floor and unaffected. They also predate
learning weekday returns by trading days.

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
0.19% (now floored at 0.2%), GLD 0.25%.

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

## Can the house make money? (`house.py`, `house-results.txt`)

A whole day of trading instead of one trader at the lock: every hour a sharp
trader moves each band to its true odds less the fee (so a higher fee means
less of it), and regular traders buy single bands (80% near the price, 20%
long shots) and hold. Same 4,493 rounds; house result per round after 90% of
fees, as a share of its deposit:

| fee | no regular traders | 1× | 3× | 10× the deposit in volume |
|---|---|---|---|---|
| flat 1% (earlier) | −15.9% | −12.1% | −9.2% | −3.0% |
| flat 2% | −15.2% | −8.6% | −2.9% | +9.5% |
| flat 3% | −14.6% | −5.7% | +2.7% | +21.5% |
| 1% rising to 5% over the last 6 h | −15.1% | −9.9% | −5.3% | +4.4% |
| 1% rising to 10% over the last 3 h | −14.8% | −9.7% | −5.1% | +5.2% |

- Against sharp flow alone no fee saves the house; volume from regular
  traders does. At 1% the house is a sponsor at every volume tested.
- A rising fee lands between flat 1% and flat 2% for the house while keeping
  1% for anyone trading more than 6 h before the close. The sharp trader here
  trades every hour; if real sharp flow bunches near the close the rising fee
  does better than shown.
- The fee's level moves the result more than its shape.

Starting the rise at 2% (`house-results-2pct.txt`):

| fee | no regular traders | 1× | 3× | 10× |
|---|---|---|---|---|
| flat 2% | −15.2% | −8.6% | −2.9% | +9.5% |
| **2% rising to 5% over the last 6 h (shipped)** | −14.6% | −7.1% | −0.2% | +14.9% |
| 2% rising to 10% over the last 3 h | −14.3% | −6.7% | +0.6% | +16.6% |

A rising fee from 2% beats flat 2% everywhere and breaks even at about 3×
the deposit in daily volume (flat 1%: never, within 10×). The house wins in
58–61% of rounds at 3× and 88–90% at 10×, and its worst 5% of rounds improve
from −24% to about −20% at 3×.

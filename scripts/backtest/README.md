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

## The house's worst counterparty

Each round opens a day before its close on the price then. At the lock (an
hour before the close) one trader knows the price at the lock and moves the
market to where the close is really likely to land from there. The house's
result is `b · ln(p_open[k] / q[k])` at the band `k` that settles, before
fees. No flow is worse for the house than this one.

## Result (`results.txt`)

| rule | house per round | worst 5% | closes off the grid |
|---|---|---|---|
| flat, 1% bands | −74.5% | −99.5% | 0% |
| bell, one fixed band width per coin | −17.3% | −41.0% | 0.1% |
| **bell, band = σ/4 from on-chain volatility** | **−16.6%** | **−35.1%** | **0%** |

Per coin the volatility rule matches or beats the hand-picked widths
everywhere, and holds where they broke: when ZEC's volatility jumped, fixed
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

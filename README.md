# Stook

Price prediction on Solana. You draw a line where you think an asset lands;
everyone who was close splits the pot.

Stook is a parimutuel market, not an order book and not a bonding curve. There
is no seed deposit, no liquidity provider and no market maker — the stake *is*
the liquidity. That is the whole reason it can open a market on any asset, any
week, and have it be tradeable from the first participant.

## How a market works

1. **Open.** A market names an asset, a settlement time, and a price band.
2. **Predict.** You pick a price and stake USDC behind it. Your stake buys no
   shares and quotes no odds — it joins a pool.
3. **Settle.** At the settlement time an oracle reads the asset's price.
4. **Claim.** Everyone who predicted the settled price splits the pot in
   proportion to what they staked, minus the protocol rake.

Implied odds are visible the whole time and are simply pool shares: a band
holding 20% of the pot is the crowd saying 20%. Being right where few others
were pays far more than being right with the crowd — accuracy is the edge, not
volume.

## Why parimutuel

A new prediction market's hardest problem is not matching or pricing, it is the
empty book. An AMM answers it by paying someone to seed liquidity; an order
book answers it by hoping a market maker shows up. A parimutuel does not have
the problem: the first participant and the thousandth face the same mechanism,
and the pot is whatever has been staked so far.

The cost is honest and worth stating: stake is locked until settlement, there
is no early exit, and late money dilutes early money unless the payout is
time-weighted.

## Status

Pre-alpha. The program is being written; nothing is deployed.

## Licence

Apache-2.0

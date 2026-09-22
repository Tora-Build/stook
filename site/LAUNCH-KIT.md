# $STOOK launch kit

Files in this folder, for the StonkFun launch form and socials:

| use | file |
|---|---|
| token image (round, 512 px) | `stook-coin-512.png` (also `-128.png`, and `stook-coin.svg`) |
| square logo with skyline | `stook-logo-512.png` / `stook-logo.svg` |
| X / Telegram banner 1500×500 | `stook-banner-1500x500.png` |
| website | `index.html` (static, one file + the two SVGs; host anywhere) |

## Form fields

**Name:** Stook Street
**Symbol:** STOOK
**Anchor / pair:** SPY

**Short description (under 200 chars):**
The coin you play Stook Street with. Draw a line where a stock will land, get paid by how close you were, or be the house. Markets settle on Pyth. Built on Solana.

**Longer description:**
Stook Street is a corner of the financial district for memecoins anchored to stocks. Every market is a bet on where a stock will be at a set time — NVDA at Friday's close, SPY at noon — quoted in the community's own coin. You draw a line at the price you expect and buy it: land on it and you're paid the most, a band or two off pays less, a mile off pays nothing. Or take the other side: put your coin in a market's pool, earn 80% of its fees, and never risk more than you put in. Settlement is the Pyth price at the settlement second, on-chain, no committee. $STOOK is the first coin the street's markets are quoted in. Markets are opened by the team, one coin at a time, no open spam.

**Website:** https://stooks.xyz  (Cloudflare Worker `stook-street`; redeploy with `cd site && npx wrangler deploy`)
**Source:** https://github.com/Tora-Build/stook (private until launch)

## What the site claims, and whether it is true today

- "Program and trading site run on Solana devnet" — true (program `55kGEMHJ…`, four markets run end to end).
- "Markets open and settle themselves from Pyth; the keeper is public and paid a bounty" — true (`infra/ladder-crank`, bounty in `ladder_settle`).
- "$STOOK launches on StonkFun, paired with SPY" — planned, not done. The site says "launches", not "launched".
- "Markets quoted in $STOOK" — the mint `GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu` carries a 1% transfer fee set by StonkFun. The program is being taught fee-bearing mints (deposits credited by what actually arrives); until that ships, a market cannot be created in $STOOK.
- Nothing on the site quotes a price, a market cap, a supply or an APY. Keep it that way until there are real numbers.

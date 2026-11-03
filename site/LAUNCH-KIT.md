# $STOOK launch kit

Files in this folder, for the StonkFun launch form and socials:

| use | file |
|---|---|
| token image (round, 512 px) | `stook-coin-512.png` (also `-128.png`, and `stook-coin.svg`) |
| square logo with skyline | `stook-logo-512.png` / `stook-logo.svg` |
| X / Telegram banner 1500×500 | `stook-banner-1500x500.png` |
| website | the app (`apps/stook`), served by the `stook-street` Worker; the old static page is in `legacy/`, unserved |

## Form fields

**Name:** Stook Street
**Symbol:** STOOK
**Anchor / pair:** SPY

**Short description (under 200 chars):**
The coin you play Stook Street with. Call where the S&P closes, get paid by how close you were, or be the house. Rounds settle on Pyth. Built on Solana.

**Longer description:**
Stook Street is a corner of the financial district for memecoins anchored to stocks. Each coin's community bets on the stock its coin is anchored to, in the coin. $STOOK is anchored to SPY, so $STOOK rounds ask where the S&P 500 closes each day at 4 PM New York. You call the price you expect and buy it: land on it and you're paid the most, a band or two off pays less, a mile off pays nothing. Or take the other side: put your coin in a round's pool, which keeps 90% of every fee (2%, rising to 5% over the last six hours) shared by depth, and never risk more than you put in. Bands are sized to how the anchor has been moving, learned on-chain from Pyth, and set when the round opens. Settlement is the Pyth price at the close, on-chain, no committee. $STOOK is the first coin the street's rounds are quoted in. Series are opened by the team one coin at a time; anyone can fund a day's round.

**Website:** https://stookstreet.xyz  (Cloudflare Worker `stook-street`; redeploy with `pnpm -F @stook/app build && cd site && npx wrangler deploy`)
**Source:** https://github.com/Tora-Build/stook (private until launch)

## What the site claims, and whether it is true today

- "Program and app run on Solana mainnet": true (program `55kGEMHJ…`). Each coin has a daily series; its rounds open once the series has learned 20 daily returns from Pyth.
- "Rounds open and settle themselves from Pyth; the keeper is public and paid a bounty": true (`infra/ladder-crank`, hosted; bounty in `ladder_settle`, half the protocol's 10% of fees). A round the keeper cannot open within five minutes, or whose closing price fails the settlement rule, voids and refunds, depositors first.
- "$STOOK is live on StonkFun, anchored to SPY": true (relaunched 2026-09-24 as a standard token; the first mint `GWrd84X5…` is retired).
- "Rounds settle on the real anchor": true. $SSt. settles on the Raydium CLMM pool of Polymarket's PreStocks token, averaged over ten minutes (`pool_oracle.rs`). The other coins open on mainnet once their anchors' Pyth feeds can be read on chain.
- "Rounds quoted in $STOOK": the current mint is a standard Token-2022 coin with no transfer fee. The program handles fee-bearing mints (deposits credited by what arrives; proven against the real mint bytes). On mainnet the protocol authority must `approve_quote_mint` it once.
- The site shows the anchors' live prices (display only) and each round's odds and pool, and quotes no market cap, supply or APY. Keep it that way until there are real numbers.

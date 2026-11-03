# $SSt. launch kit

Files in this folder, for the StonkFun launch form and socials:

| use | file |
|---|---|
| token image (round, 512 px) | `stook-coin-512.png` (also `-128.png`, and `stook-coin.svg`) |
| square logo with skyline | `stook-logo-512.png` / `stook-logo.svg` |
| X / Telegram banner 1500×500 | `stook-banner-1500x500.png` |
| website | the app (`apps/stook`), served by the `stook-street` Worker; the old static page is in `legacy/`, unserved |

## Form fields

**Name:** Stook Street
**Symbol:** SSt.
**Anchor / pair:** Polymarket (PreStocks)

**Short description (under 200 chars):**
The coin you play Stook Street with. Call where Polymarket closes at 4 PM New York, get paid by how close you were, or be the house. Built on Solana.

**Longer description:**
Stook Street is a daily game for any coin. Each day holders call where a price closes at 4 PM New York, and are paid in the coin. $SSt. plays Polymarket, priced from its Raydium pool. Holders run the house and keep 90% of the fees.

**Website:** https://stookstreet.xyz  (Cloudflare Worker `stook-street`; redeploy with `pnpm -F @stook/app build && cd site && npx wrangler deploy`)
**Source:** https://github.com/Tora-Build/stook (private until launch)

## What the site claims, and whether it is true today

- "Program and app run on Solana mainnet": true (program `55kGEMHJ…`). Each coin has a daily series; its rounds open once the series has learned 20 daily returns from Pyth.
- "Rounds open and settle themselves from Pyth; the keeper is public and paid a bounty": true (`infra/ladder-crank`, hosted; bounty in `ladder_settle`, half the protocol's 10% of fees). A round the keeper cannot open within five minutes, or whose closing price fails the settlement rule, voids and refunds, depositors first.
- "Rounds settle on the real anchor": true. $SSt. settles on the Raydium CLMM pool of Polymarket's PreStocks token, averaged over ten minutes (`pool_oracle.rs`). The other coins open on mainnet once their anchors' Pyth feeds can be read on chain.
- "Rounds quoted in $SSt.": the current mint is a standard Token-2022 coin with no transfer fee. The program handles fee-bearing mints (deposits credited by what arrives; proven against the real mint bytes). On mainnet the protocol authority must `approve_quote_mint` it once.
- The site shows the anchors' live prices (display only) and each round's odds and pool, and quotes no market cap, supply or APY. Keep it that way until there are real numbers.

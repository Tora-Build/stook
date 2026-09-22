# tape

Live prices for the street's anchors, from their Solana pools, for the tables
and the charts. **Display only.** A round settles on Pyth, read by the program
on chain; a price this box computes is a price this box could lie about, so it
is never used to settle anything.

| coin | pool | price |
|---|---|---|
| STOOK | SPYx/USDC, Raydium CLMM `6truu3r…` | USDC per SPYx |
| GP | GLDx/USDC, Raydium CLMM `78ReVNM…` | USDC per GLDx |
| ZCAT | ZEC/USDC, Orca Whirlpool `GTHKH8s…` | USDC per ZEC |
| KNOTS | STONK/SPYx, Raydium CLMM `7a8xxAJ…` | SPYx per STONK × the SPYx price |

One WebSocket to mainnet, `accountSubscribe` on the four pool accounts; every
state change is a swap, and the price is read from the pool's `sqrt_price`.
One-minute candles are kept for a week in `~/stook-tape.json`.

Runs on the tora box under cron (`deploy/keepalive.sh`), on port 8791, and
reaches the world through a Cloudflare quick tunnel whose address it announces
to the Worker (`POST /tape/register`, bearer `TAPE_TOKEN`, stored in KV). The
Worker then serves `/prices` from it (5 s cache), `/chart` from its candles,
and proxies `/tape/candles` and `/tape/stream` (SSE) live.

Endpoints on the box: `/prices`, `/candles?coin=&res=60|300|900&from=`,
`/stream`, `/health`.

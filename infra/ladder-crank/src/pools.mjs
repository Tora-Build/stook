// Pool-fed anchors (program: `pool_oracle`): a series or round whose feed id
// is a Raydium CLMM pool's address. Its price for an instant is the pool's
// ten-minute average to it, from the pool's observation account, so there is
// nothing to fetch from Pyth and nothing to post: the keeper reads both
// accounts, works out the price the program will (`stook.poolPriceAt`), and
// passes the pool in the price slot with its observation account after it.
//
// `routed` puts this in front of the Pyth source: every price the keeper
// asks for goes to the pool when the feed id is a pool's address.

import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";

export function poolPrices(connection) {
  const owners = new Map();
  /** Is the feed id a pool's address? Asked once per feed. */
  async function isPool(feedHex) {
    if (!owners.has(feedHex)) {
      const a = await connection.getAccountInfo(new PublicKey(Buffer.from(feedHex, "hex")));
      owners.set(feedHex, !!a && stook.isPoolOwner(a.owner));
    }
    return owners.get(feedHex);
  }
  /** The price at `at` (or, `live`, at the pool's latest entry), in Hermes' `parsed` shape, marked `pool`. */
  async function price(feedHex, at, live = false) {
    const pool = new PublicKey(Buffer.from(feedHex, "hex"));
    const p = stook.decodePool((await connection.getAccountInfo(pool)).data);
    const obs = stook.decodeObservations((await connection.getAccountInfo(p.observation)).data);
    const vaas = { pool, observation: p.observation };
    const t = live ? stook.latestObservation(obs) : Number(at);
    const r = t ? stook.poolPriceAt(p, obs, t) : null;
    if (!r) return { parsed: undefined, vaas };
    return { parsed: { id: feedHex, price: { price: String(r.price), conf: "0", expo: stook.POOL_EXPONENT, publish_time: t }, metadata: { prev_publish_time: t - 1 }, pool: true }, vaas };
  }
  return { isPool, price };
}

/** `fetch(path, feedHex, { live })` that answers pool feeds from the pool and the rest from `fallback`. */
export function routed(pools, fallback) {
  return async (path, feedHex, opts = {}) => ((await pools.isPool(feedHex)) ? pools.price(feedHex, path.split("/").pop(), opts.live) : fallback(path, feedHex, opts));
}

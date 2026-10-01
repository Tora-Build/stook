// Which coin a round is in, and how its prices are written. A round's coin is
// its quote mint; on devnet the mints are twins named in DEVNET_MINTS (as
// apps/stook/src/lib/coins.ts), so without that map the coin is inferred from
// the feed a coin's rounds run on. Prices show the feed's decimal places.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Feeds the street's rounds settle on: devnet's stand-ins and mainnet's anchors. */
export const FEEDS = {
  // devnet stand-ins (lib/coins.ts DEVNET_FEEDS)
  e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43: { coin: "STOOK", symbol: "BTC", name: "Bitcoin", dp: 0 },
  ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace: { coin: "ZCAT", symbol: "ETH", name: "Ether", dp: 2 },
  ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d: { coin: "KNOTS", symbol: "SOL", name: "Solana", dp: 2 },
  dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c: { coin: "GP", symbol: "DOGE", name: "Dogecoin", dp: 4 },
  // mainnet anchors (lib/coins.ts COINS)
  "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14": { coin: "STOOK", symbol: "SPYx", name: "S&P 500", dp: 2 },
  be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24: { coin: "ZCAT", symbol: "ZEC", name: "Zcash", dp: 2 },
  f68272be1240150c36b54dce26a9b75f62f507a94f49f43533a5050c77e07049: { coin: "KNOTS", symbol: "STONK", name: "STONK", dp: 4 },
  e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96: { coin: "GP", symbol: "GLDx", name: "Gold", dp: 2 },
};

/** {symbol: mint} from LEDGER_MINTS or DEVNET_MINTS, else the DEVNET_MINTS
 *  line of ~/sim/sim.env (read for that one key only). */
export function loadMints(env = process.env) {
  const parse = (v) => { try { const j = JSON.parse(v); return j && typeof j === "object" ? j : null; } catch { return null; } };
  const direct = parse(env.LEDGER_MINTS || "") ?? parse(env.DEVNET_MINTS || "");
  if (direct) return direct;
  try {
    const line = readFileSync(join(env.SIM_DIR ?? join(homedir(), "sim"), "sim.env"), "utf8").split(/\r?\n/).find((l) => /^\s*(export\s+)?DEVNET_MINTS=/.test(l));
    if (line) return parse(line.slice(line.indexOf("=") + 1).trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1")) ?? {};
  } catch { /* no sim on this machine */ }
  return {};
}

export function coinBook(mints = {}) {
  const byMint = new Map(Object.entries(mints).map(([sym, mint]) => [mint, sym]));
  return {
    /** The coin's symbol for a round, or null for a round in some other token. */
    coin(quoteMint, feedId) {
      if (quoteMint && byMint.size) return byMint.get(quoteMint) ?? null;
      return FEEDS[feedId]?.coin ?? null;
    },
    feed: (feedId) => FEEDS[feedId] ?? null,
  };
}

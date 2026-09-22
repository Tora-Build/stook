// The coins on the street, and the stock each is anchored to. Curated by
// hand — a coin joins when the team adds it here, never by pasting a mint.
//
// A coin's rounds are ON its anchor and IN the coin: the oracle reads the
// anchor's Pyth feed, the coin is what lines are bought with. Feed choice per
// anchor: the 24/7 feed where one exists (Pyth's xStock feeds for tokenized
// equities), the market-hours feed otherwise — a round must settle inside
// its feed's hours or it voids.
import { PublicKey } from "@solana/web3.js";

export interface Anchor {
  symbol: string;
  name: string;
  feedId: string;
  /** "24/7", or the hours a round must settle inside. */
  hours: string;
  dp: number;
}

export interface Coin {
  symbol: string;
  name: string;
  /** Mainnet mint, on StonkFun. */
  mint: string;
  decimals: number;
  /** The mint's transfer fee, as launched. Informational; the program reads the live schedule. */
  feeBps: number;
  anchor: Anchor;
}

export const COINS: Coin[] = [
  {
    symbol: "STOOK", name: "Stook Street", mint: "GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu", decimals: 6, feeBps: 100,
    anchor: { symbol: "SPY", name: "S&P 500 (SPYx)", feedId: "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14", hours: "24/7", dp: 2 },
  },
  {
    symbol: "ZCAT", name: "Anonymous Cat", mint: "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR", decimals: 9, feeBps: 300,
    anchor: { symbol: "ZEC", name: "Zcash", feedId: "be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", hours: "24/7", dp: 2 },
  },
  {
    symbol: "KNOTS", name: "KNOTS", mint: "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS", decimals: 6, feeBps: 300,
    anchor: { symbol: "STONK", name: "STONK", feedId: "f68272be1240150c36b54dce26a9b75f62f507a94f49f43533a5050c77e07049", hours: "24/7", dp: 4 },
  },
  {
    symbol: "GP", name: "RuneScape Gold", mint: "HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ", decimals: 6, feeBps: 300,
    anchor: { symbol: "GLDx", name: "Gold", feedId: "e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96", hours: "24/7", dp: 2 },
  },
];

/**
 * On devnet the mainnet mints do not exist; `scripts/devnet/coins.mjs` makes
 * twins (same decimals, same fee) and writes their addresses to
 * VITE_DEVNET_MINTS as {symbol: mint}. A coin's effective mint is the twin
 * when one is configured.
 */
const devnetMints: Record<string, string> = (() => {
  try { return JSON.parse(import.meta.env.VITE_DEVNET_MINTS || "{}"); } catch { return {}; }
})();

/** The coin's mint on this cluster, or null while the mainnet mint is unknown and no twin exists. */
export const mintOf = (c: Coin): PublicKey | null => { const k = devnetMints[c.symbol] ?? c.mint; return k ? new PublicKey(k) : null; };
export const coinByMint = (mint: PublicKey): Coin | undefined => {
  const k = mint.toBase58();
  return COINS.find((c) => (c.mint && c.mint === k) || devnetMints[c.symbol] === k);
};
export const feedHexToBytes = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

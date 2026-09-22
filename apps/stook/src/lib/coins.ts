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
    symbol: "ALLINU", name: "ALLINU", mint: "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8", decimals: 6, feeBps: 100,
    anchor: { symbol: "DKNG", name: "DraftKings", feedId: "c0713033a43355d99ca9bb3d77aaba2341efaded3a9518f201331a3f0c1c374c", hours: "NY 09:30–16:00", dp: 2 },
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

export const mintOf = (c: Coin): PublicKey => new PublicKey(devnetMints[c.symbol] ?? c.mint);
export const coinByMint = (mint: PublicKey): Coin | undefined => {
  const k = mint.toBase58();
  return COINS.find((c) => c.mint === k || devnetMints[c.symbol] === k);
};
export const feedHexToBytes = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

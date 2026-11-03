// The coins on the street, and the stock each is anchored to. Curated by
// hand — a coin joins when the team adds it here, never by pasting a mint.
//
// A coin's rounds are ON its anchor and IN the coin: the oracle reads the
// anchor's Pyth feed, the coin is what lines are bought with. Feed choice per
// anchor: the 24/7 feed where one exists (Pyth's xStock feeds for tokenized
// equities), the market-hours feed otherwise — a round must settle inside
// its feed's hours or it voids.
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { listedByMint, listedBySymbol } from "./listed";

export interface Anchor {
  symbol: string;
  name: string;
  /** The anchor's own Solana mint — the token the coin is paired with. Shown so nobody buys a look-alike. */
  mint: string;
  logo: string;
  feedId: string;
  /** Set when the anchor is priced from a Raydium CLMM pool, not Pyth: the
   *  pool's address, which is also the feed id. */
  pool?: string;
  /** "24/7", or the hours a round must settle inside. */
  hours: string;
  dp: number;
}

export interface Coin {
  /** The ticker shown everywhere: the mint's own symbol. */
  symbol: string;
  /** The name the site's data routes (/prices, /coins, /chart, /days), the
   *  test-build maps and the page's address use, where it differs from the
   *  symbol: $SSt. was $STOOK (`keyOf`). */
  key?: string;
  name: string;
  logo: string;
  /** Mainnet mint, on StonkFun. $STOOK's comes from the build's environment
   *  (VITE_STOOK_MINT), not the repo; empty means unknown. */
  mint: string;
  decimals: number;
  /** The mint's transfer fee, as launched. Informational; the program reads the live schedule. */
  feeBps: number;
  anchor: Anchor;
}

export const COINS: Coin[] = [
  {
    symbol: "SSt.", key: "STOOK", name: "STOOK St.", logo: "/logos/stook.png", mint: import.meta.env.VITE_STOOK_MINT ?? "", decimals: 6, feeBps: 0,
    // Polymarket PreStocks (prestocks.com), priced from its Raydium CLMM pool
    // (5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs): the feed id is the pool's address.
    anchor: { symbol: "POLYMARKET", name: "Polymarket", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", logo: "/logos/polymarket.png", feedId: "45541ba20dabe3e68b11405564e749ac0119de0e5f4a1aa441e60e3335b737c8", pool: "5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs", hours: "24/7", dp: 2 },
  },
  {
    symbol: "ZCAT", name: "Anonymous Cat", logo: "/logos/zcat.jpg", mint: "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR", decimals: 9, feeBps: 300,
    anchor: { symbol: "ZEC", name: "Zcash", mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS", logo: "/logos/zec.svg", feedId: "be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", hours: "24/7", dp: 2 },
  },
  {
    symbol: "KNOTS", name: "KNOTS", logo: "/logos/knots.png", mint: "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS", decimals: 6, feeBps: 300,
    anchor: { symbol: "STONK", name: "STONK", mint: "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx", logo: "/logos/stonk.png", feedId: "f68272be1240150c36b54dce26a9b75f62f507a94f49f43533a5050c77e07049", hours: "24/7", dp: 4 },
  },
  {
    symbol: "GP", name: "RuneScape Gold", logo: "/logos/gp.jpg", mint: "HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ", decimals: 6, feeBps: 300,
    anchor: { symbol: "GLDx", name: "Gold", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", logo: "/logos/gldx.png", feedId: "e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96", hours: "24/7", dp: 2 },
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

/**
 * The build can point a coin's rounds at another feed: VITE_FEED_OVERRIDES as
 * {key: {symbol, name, feedId, dp}}. Empty uses each coin's own anchor.
 */
const feedOverrides: Record<string, { symbol: string; name: string; feedId: string; dp: number }> = (() => {
  try { return JSON.parse(import.meta.env.VITE_FEED_OVERRIDES || "{}"); } catch { return {}; }
})();
// Decided at build time, so a mainnet build carries no test-coin text at all.
export const isDevnet = import.meta.env.VITE_CLUSTER !== "mainnet-beta" && Object.keys(devnetMints).length > 0;
/** The feed a coin's rounds settle on in this build. */
export const anchorOf = (c: Coin): Anchor => {
  const d = feedOverrides[keyOf(c)];
  return d ? { ...c.anchor, symbol: d.symbol, name: d.name, feedId: d.feedId, dp: d.dp } : c.anchor;
};

/** The street coin whose anchor is the pool behind this feed id, if any. */
export const poolCoinOf = (feedHex: string): Coin | undefined => COINS.find((c) => !!c.anchor.pool && c.anchor.feedId === feedHex);

/** A coin's daily series: its rounds, one per day, closing 4 PM New York. */
export const seriesOf = (c: Coin): PublicKey | null => { const m = mintOf(c), f = anchorOf(c).feedId; return m && f ? stook.deriveSeries(feedHexToBytes(f), m, 0) : null; };

/** The coin's mint on this cluster, or null while the mainnet mint is unknown and no twin exists. */
export const mintOf = (c: Coin): PublicKey | null => { const k = devnetMints[keyOf(c)] ?? c.mint; return k ? new PublicKey(k) : null; };
/** A coin by its mint: the street's own, or one listed on chain (lib/listed). */
export const coinByMint = (mint: PublicKey): Coin | undefined => {
  const k = mint.toBase58();
  return COINS.find((c) => (c.mint && c.mint === k) || devnetMints[keyOf(c)] === k) ?? listedByMint(k);
};
/** A coin by its symbol, the street's own or listed. */
export const coinBySymbol = (symbol: string): Coin | undefined => {
  const s = symbol.toUpperCase();
  return COINS.find((c) => c.symbol.toUpperCase() === s || keyOf(c) === s) ?? listedBySymbol(s);
};
/** A coin's name in the site's data routes and its page's address (`Coin.key`). */
export const keyOf = (c: Pick<Coin, "symbol" | "key">): string => c.key ?? c.symbol;
/** A coin's page. */
export const coinPath = (c: Pick<Coin, "symbol" | "key">) => `/c/${keyOf(c)}`;
/** A map from the site's data routes, keyed by `keyOf`, keyed by symbol instead. */
export const bySymbol = <T,>(m: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(m).map(([k, v]) => [COINS.find((c) => keyOf(c) === k)?.symbol ?? k, v]));
export const feedHexToBytes = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

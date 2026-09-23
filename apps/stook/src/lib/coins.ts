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

export interface Anchor {
  symbol: string;
  name: string;
  /** The anchor's own Solana mint — the token the coin is paired with. Shown so nobody buys a look-alike. */
  mint: string;
  logo: string;
  feedId: string;
  /** "24/7", or the hours a round must settle inside. */
  hours: string;
  dp: number;
}

export interface Coin {
  symbol: string;
  name: string;
  logo: string;
  /** Mainnet mint, on StonkFun. */
  mint: string;
  decimals: number;
  /** The mint's transfer fee, as launched. Informational; the program reads the live schedule. */
  feeBps: number;
  anchor: Anchor;
}

export const COINS: Coin[] = [
  {
    symbol: "STOOK", name: "Stook Street", logo: "/logos/stook.png", mint: "GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu", decimals: 6, feeBps: 100,
    anchor: { symbol: "SPYx", name: "S&P 500", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", logo: "/logos/spyx.png", feedId: "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14", hours: "24/7", dp: 2 },
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

/** The coin's mint on this cluster, or null while the mainnet mint is unknown and no twin exists. */
/**
 * Devnet stand-in feeds. The Pyth key this deployment settles with covers
 * crypto majors only, so on devnet each coin's rounds run on a major the
 * keeper can actually open and settle; the app says so on the page. Mainnet
 * uses the real anchors above. Remove the entry for a coin once its anchor
 * feed is entitled.
 */
const DEVNET_FEEDS: Record<string, { symbol: string; name: string; feedId: string; dp: number }> = {
  STOOK: { symbol: "BTC", name: "Bitcoin", feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", dp: 0 },
  ZCAT: { symbol: "ETH", name: "Ether", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", dp: 2 },
  KNOTS: { symbol: "SOL", name: "Solana", feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", dp: 2 },
  GP: { symbol: "DOGE", name: "Dogecoin", feedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", dp: 4 },
};
export const isDevnet = Object.keys(devnetMints).length > 0;
/** The feed a coin's rounds settle on, here: the anchor on mainnet, a stand-in on devnet. */
export const anchorOf = (c: Coin): Anchor => {
  const d = isDevnet ? DEVNET_FEEDS[c.symbol] : undefined;
  return d ? { ...c.anchor, symbol: d.symbol, name: d.name, feedId: d.feedId, dp: d.dp } : c.anchor;
};
export const standInNote = (c: Coin): string | null => (isDevnet && DEVNET_FEEDS[c.symbol] ? `Devnet: rounds here run on the ${DEVNET_FEEDS[c.symbol]!.name} price (${DEVNET_FEEDS[c.symbol]!.symbol}) as a stand-in for ${c.anchor.symbol}, which has no Pyth feed on devnet. On mainnet they settle on ${c.anchor.symbol}.` : null);

/** A coin's daily series: its rounds, one per day, closing 4 PM New York. */
export const seriesOf = (c: Coin): PublicKey | null => { const m = mintOf(c); return m ? stook.deriveSeries(feedHexToBytes(anchorOf(c).feedId), m, 0) : null; };

export const mintOf = (c: Coin): PublicKey | null => { const k = devnetMints[c.symbol] ?? c.mint; return k ? new PublicKey(k) : null; };
export const coinByMint = (mint: PublicKey): Coin | undefined => {
  const k = mint.toBase58();
  return COINS.find((c) => (c.mint && c.mint === k) || devnetMints[c.symbol] === k);
};
export const feedHexToBytes = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

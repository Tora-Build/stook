// Coins anyone listed (program: `coin_list`), read from chain: every house
// whose coin is not one of the street's own (lib/coins), with the coin's name,
// symbol and logo from its token metadata. Nothing here is curated, so the
// app always shows a listed coin's mint and says who listed it: the
// community, not the street.

import { useSyncExternalStore } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
import { COINS, anchorOf, keyOf, mintOf, type Anchor, type Coin } from "./coins";
import { SCAN_RPC_URL } from "./config";

/** A letter badge for a coin or anchor with no logo of its own. */
export function badge(symbol: string, hue = 200): string {
  const t = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue} 45% 38%)"/><text x="32" y="${t.length > 3 ? 38 : 40}" font-family="monospace" font-weight="700" font-size="${t.length > 3 ? 16 : 20}" text-anchor="middle" fill="#f4e9c8">${t}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Anchors a coin may be listed on, by feed: the free on-chain Pyth feeds (and devnet's stand-ins). */
export const LISTABLE: Record<string, Anchor> = {
  be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24: { symbol: "ZEC", name: "Zcash", mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS", logo: "/logos/zec.svg", feedId: "be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", hours: "24/7", dp: 2 },
  ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d: { symbol: "SOL", name: "Solana", mint: "So11111111111111111111111111111111111111112", logo: badge("SOL", 270), feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", hours: "24/7", dp: 2 },
  e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43: { symbol: "BTC", name: "Bitcoin", mint: "", logo: badge("BTC", 32), feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", hours: "24/7", dp: 0 },
  ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace: { symbol: "ETH", name: "Ether", mint: "", logo: badge("ETH", 230), feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", hours: "24/7", dp: 2 },
  "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2": { symbol: "XAU", name: "Gold", mint: "", logo: badge("XAU", 45), feedId: "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2", hours: "weekdays", dp: 2 },
  dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c: { symbol: "DOGE", name: "Dogecoin", mint: "", logo: badge("DOGE", 40), feedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", hours: "24/7", dp: 4 },
};

export interface Listing { series: PublicKey; house: PublicKey; opensAfter: bigint; state: stook.ListingState }
export type ListedCoin = Coin & { listing: Listing };

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const metadataPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), METADATA_PROGRAM.toBytes(), mint.toBytes()], METADATA_PROGRAM)[0];

export interface TokenMeta { name: string; symbol: string; uri: string }
const clean = (s: string) => s.replace(/\0/g, "").trim();
function borshStr(d: Uint8Array, o: number): [string, number] {
  const n = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true);
  return [clean(new TextDecoder().decode(d.subarray(o + 4, o + 4 + n))), o + 4 + n];
}
/** A Metaplex metadata account's name, symbol and URI. */
export function parseMetaplex(d: Uint8Array): TokenMeta | null {
  try { const [name, a] = borshStr(d, 1 + 32 + 32); const [symbol, b] = borshStr(d, a); const [uri] = borshStr(d, b); return { name, symbol, uri }; } catch { return null; }
}
/** A Token-2022 mint's metadata extension (type 19), if it has one. */
export function parseToken2022Meta(d: Uint8Array): TokenMeta | null {
  if (d.length <= 166 || d[165] !== 1) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let o = 166; o + 4 <= d.length;) {
    const type = v.getUint16(o, true), len = v.getUint16(o + 2, true);
    if (type === 19) {
      try { const p = o + 4 + 32 + 32; const [name, a] = borshStr(d, p); const [symbol, b] = borshStr(d, a); const [uri] = borshStr(d, b); return { name, symbol, uri }; } catch { return null; }
    }
    if (type === 0) break;
    o += 4 + len;
  }
  return null;
}

async function logoFrom(uri: string): Promise<string | null> {
  if (!/^https?:\/\//.test(uri)) return null;
  try {
    const r = await fetch(uri, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return typeof j?.image === "string" && /^https?:\/\//.test(j.image) ? j.image : null;
  } catch { return null; }
}

/** Every listed coin on chain, curated coins' houses left out. */
export async function loadListed(connection: Connection): Promise<ListedCoin[]> {
  const scanner = new Connection(SCAN_RPC_URL, "confirmed");
  const curated = new Set(COINS.map((c) => mintOf(c)?.toBase58()).filter(Boolean));
  const houses = (await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.houseFilters() }))
    .map((a) => ({ key: a.pubkey, h: stook.decodeHouse(a.account.data) }))
    .filter((x) => !curated.has(x.h.quoteMint.toBase58()));
  if (!houses.length) return [];
  const many = async (keys: PublicKey[]) => { const out = []; for (let i = 0; i < keys.length; i += 100) out.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 100)))); return out; };
  const [series, mints, metas] = await Promise.all([
    many(houses.map((x) => x.h.series)), many(houses.map((x) => x.h.quoteMint)), many(houses.map((x) => metadataPda(x.h.quoteMint))),
  ]);
  const taken = new Set(COINS.flatMap((c) => [c.symbol.toUpperCase(), keyOf(c)]));
  const out: ListedCoin[] = [];
  for (let n = 0; n < houses.length; n++) {
    const { key, h } = houses[n]!;
    const s = series[n] ? stook.decodeSeries(series[n]!.data) : null, m = mints[n];
    if (!s || !m || s.periodSecs !== 0) continue;
    const anchor = LISTABLE[Buffer.from(s.feedId).toString("hex")];
    if (!anchor) continue;
    const meta = (metas[n] ? parseMetaplex(metas[n]!.data) : null) ?? parseToken2022Meta(m.data);
    const mint = h.quoteMint.toBase58();
    // A listed coin never takes a name the street or an earlier listing holds.
    let symbol = (meta?.symbol || mint.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || mint.slice(0, 4).toUpperCase();
    if (taken.has(symbol)) symbol = `${symbol}-${mint.slice(0, 4).toUpperCase()}`;
    taken.add(symbol);
    out.push({
      symbol, name: meta?.name || symbol, logo: badge(symbol), mint, decimals: m.data[44]!, feeBps: 0, anchor,
      listing: { series: h.series, house: key, opensAfter: h.opensAfter, state: stook.listingState(h, s) },
    });
    const c = out[out.length - 1]!;
    if (meta?.uri) void logoFrom(meta.uri).then((src) => { if (src) { c.logo = src; emit(); } });
  }
  return out;
}

// ── the store ────────────────────────────────────────────────────────────────

let listed: ListedCoin[] = [];
let ready = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };

/** Load once per page view; components that use `useListed` re-render when it lands. */
export function ensureListed(connection: Connection): Promise<void> {
  loading ??= loadListed(connection).then((l) => { listed = l; }).catch(() => { /* the street works without them */ }).finally(() => { ready = true; emit(); });
  return loading;
}
export function reloadListed(connection: Connection): Promise<void> { loading = null; return ensureListed(connection); }

export const listedCoins = () => listed;
export const listedByMint = (mint: string) => listed.find((c) => c.mint === mint);
export const listedBySymbol = (symbol: string) => listed.find((c) => c.symbol.toUpperCase() === symbol.toUpperCase());

export function useListed(connection: Connection): { coins: ListedCoin[]; ready: boolean } {
  void ensureListed(connection);
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return { coins: listed, ready };
}

/** A curated coin on the same feed: its quotes and chart serve a listed coin's anchor. */
/** The name its anchor's quotes and chart go by in the site's data routes (`keyOf`). */
export const quoteKeyOf = (c: Coin) => { const own = "listing" in c ? COINS.find((x) => anchorOf(x).feedId === c.anchor.feedId) : c; return own ? keyOf(own) : c.symbol; };

// What the list page reads: the anchors open for listing, the protocol's
// listing fee, a pasted coin's supply, name, symbol and logo, and the live
// price of an anchor. All from the chain or the site's own routes.
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
import { SCAN_RPC_URL } from "../../lib/config";
import { LISTABLE, badge, parseMetaplex, parseToken2022Meta, type TokenMeta } from "../../lib/listed";

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export const parseKey = (s: string) => { const t = s.trim(); if (t.length < 32 || t.length > 44) return null; try { return new PublicKey(t); } catch { return null; } };

/** Base units as a plain decimal string, exact (no float math on big supplies). */
export function unitsToText(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString();
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals), frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** An amount as text with its whole part in groups of three: "162,867,674,166.5". */
export function groupText(text: string): string {
  const m = text.trim().replace(/,/g, "").match(/^(\d+)(\.\d*)?$/);
  return m ? m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m[2] ?? "") : text;
}

/** The anchors a coin can be listed on here: active on chain and on the app's list. */
export function useAnchors() {
  return useQuery({
    queryKey: ["list-anchors"],
    queryFn: async () => {
      const scanner = new Connection(SCAN_RPC_URL, "confirmed");
      const all = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.listAnchorFilters() });
      return all.map((a) => stook.decodeListAnchor(a.account.data)).filter((a) => a.active).map((a) => ({ ...a, hex: Buffer.from(a.feedId).toString("hex") })).filter((a) => LISTABLE[a.hex]);
    },
    staleTime: 300_000,
  });
}

export function useProtocolConfig() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["protocol-config"],
    queryFn: async () => { const a = await connection.getAccountInfo(stook.deriveProtocolConfig()); return a ? stook.decodeProtocolConfig(a.data) : null; },
    staleTime: 300_000,
  });
}

async function logoFrom(uri: string): Promise<string | null> {
  if (!/^https?:\/\//.test(uri)) return null;
  try {
    const r = await fetch(uri, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return typeof j?.image === "string" && /^https?:\/\//.test(j.image) ? j.image : null;
  } catch { return null; }
}

export interface CoinLook { supply: bigint; meta: TokenMeta | null; logo: string | null }

/** A pasted mint: its supply and token metadata (Metaplex or Token-2022), null when no account. */
export function useCoinLook(mint: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["list-coin", mint?.toBase58()],
    enabled: !!mint,
    staleTime: 60_000,
    queryFn: async (): Promise<CoinLook | null> => {
      const meta = PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), METADATA_PROGRAM.toBytes(), mint!.toBytes()], METADATA_PROGRAM)[0];
      const [m, md] = await connection.getMultipleAccountsInfo([mint!, meta]);
      if (!m || m.data.length < 82) return null;
      const supply = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength).getBigUint64(36, true);
      const t: TokenMeta | null = (md ? parseMetaplex(md.data) : null) ?? parseToken2022Meta(new Uint8Array(m.data));
      return { supply, meta: t, logo: t?.uri ? await logoFrom(t.uri) : null };
    },
  });
}

/** The ticker a coin shows: its own symbol, or the first letters of the mint. */
export const symOf = (look: CoinLook | null | undefined, mint: PublicKey | null) =>
  (look?.meta?.symbol || "").replace(/\0/g, "").trim().toUpperCase() || (mint ? mint.toBase58().slice(0, 4).toUpperCase() : "");
export const logoOf = (look: CoinLook | null | undefined, sym: string) => look?.logo ?? (sym ? badge(sym) : null);

/** An anchor's price now, from the site's /pyth route (display only). */
export function useAnchorPrice(hex: string | null) {
  return useQuery({
    queryKey: ["list-pyth", hex],
    enabled: !!hex,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await fetch(`/pyth?id=${hex}`);
      if (!r.ok || !r.headers.get("content-type")?.includes("json")) return null;
      const j = await r.json();
      const p = Number(j?.price) * 10 ** Number(j?.expo);
      return Number.isFinite(p) && p > 0 ? p : null;
    },
  });
}

/** The coin's dollar price from Jupiter, when it trades (null on devnet test coins). */
export function useCoinUsd(mint: { toBase58(): string } | null) {
  const id = mint?.toBase58() ?? null;
  return useQuery({
    queryKey: ["list-usd", id],
    enabled: !!id,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${id}`);
      if (!r.ok) return null;
      const p = Number((await r.json())?.[id!]?.usdPrice);
      return Number.isFinite(p) && p > 0 ? p : null;
    },
  });
}

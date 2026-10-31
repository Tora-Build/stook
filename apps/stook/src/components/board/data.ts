// The Board's data: the ledger's caller records through the site's
// /leaderboard route, and small helpers the board's parts share.
import { useQuery } from "@tanstack/react-query";
import { keyOf, type Coin } from "../../lib/coins";
import { fmtCompact } from "../../lib/format";

export interface Player { rank: number; wallet: string; bot: string | null; rounds: number; won: number; missed: number; hit: number; paid: string; back: string; net: string; best: string; last: number }
export interface Board { coin: string; decimals: number | null; days?: number; players: number; people: number; board: Player[]; peopleBoard: Player[]; scoredAt: number; indexed?: { through: number | null; complete: boolean } }

export const PERIODS: [number, string][] = [[7, "This week"], [30, "30 days"], [0, "All time"]];
export const periodName = (d: number) => PERIODS.find(([n]) => n === d)?.[1] ?? "";

async function fetchBoard(coin: string, days: number): Promise<Board> {
  const r = await fetch(`/leaderboard?${new URLSearchParams({ coin, days: String(days), limit: "25" })}`);
  if (!r.ok) throw new Error(`leaderboard ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) throw new Error("leaderboard: not JSON");
  return r.json();
}

/** The route keys a coin by its data name ($SSt. is STOOK), never by the ticker. */
export function useBoard(coin: Coin, days: number) {
  const key = keyOf(coin);
  return useQuery({ queryKey: ["board", key, days], queryFn: () => fetchBoard(key, days), staleTime: 60_000, refetchInterval: 5 * 60_000 });
}

export const abs = (v: bigint) => (v < 0n ? -v : v);
export const signOf = (v: bigint) => (v > 0n ? "+" : v < 0n ? "−" : "");
export const tone = (v: bigint) => (v > 0n ? "up" : v < 0n ? "down" : "");
export const coinAmt = (u: bigint, dec: number, sign = false) => `${sign ? signOf(u) : ""}${fmtCompact(abs(u), dec)}`;
export const shortAddr = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

/** "2 h ago", "3 d ago": when a caller's last settled round rang. */
export function ago(t: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - t);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** A steady number from a wallet, so each caller keeps one look. */
export function seed(w: string): number {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
  return h >>> 0;
}

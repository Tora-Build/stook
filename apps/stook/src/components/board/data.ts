// The Board's data: the ledger's caller records through the site's
// /leaderboard route, and small helpers the board's parts share. A coin's
// board ranks by net in that coin; the all-coins board (`ALL`) by season
// points, with each caller's net kept per coin.
import { useQuery } from "@tanstack/react-query";
import { keyOf, type Coin } from "../../lib/coins";
import { fmtCompact } from "../../lib/format";

export interface Player {
  rank: number; wallet: string; bot: string | null; rounds: number; won: number; missed: number; hit: number; points: number; last: number;
  /** A coin's board. */
  paid?: string; back?: string; net?: string; best?: string;
  /** The all-coins board: the net in each coin. */
  coins?: Record<string, { net: string; decimals: number | null }>;
}
export interface Week { n: number; from: number; to: number }
export interface Board { coin: string; decimals: number | null; days?: number; week?: Week | null; season?: string; players: number; people: number; board: Player[]; peopleBoard: Player[]; scoredAt: number; indexed?: { through: number | null; complete: boolean } }

/** Every coin at once, ranked by season points. */
export const ALL = "ALL";
export const PERIODS: [number, string][] = [[7, "7 days"], [30, "30 days"], [0, "All time"]];
export const periodName = (d: number) => PERIODS.find(([n]) => n === d)?.[1] ?? "";

/** How a caller's score shows on the podium and in their row. */
export interface Score { main: string; unit: string; sub?: string; tone: string; title?: string }

async function fetchBoard(coin: string, days: number, week: number | null): Promise<Board> {
  const q = new URLSearchParams({ coin, days: String(days), limit: "25" });
  if (week !== null) q.set("week", String(week));
  const r = await fetch(`/leaderboard?${q}`);
  if (!r.ok) throw new Error(`leaderboard ${r.status}`);
  if (!(r.headers.get("content-type") ?? "").includes("json")) throw new Error("leaderboard: not JSON");
  return r.json();
}

/** The route keys a coin by its data name (`keyOf`), never by the ticker; `null` is every coin. */
export function useBoard(coin: Coin | null, days: number, week: number | null = null) {
  const key = coin ? keyOf(coin) : ALL;
  return useQuery({ queryKey: ["board", key, days, week], queryFn: () => fetchBoard(key, days, week), staleTime: 60_000, refetchInterval: 5 * 60_000 });
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

/** "1d 4h", "3h 12m", "8m": the time left to `t`. */
export function left(t: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(t - now));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

// What the home page reads: each street coin's current round on this
// network, the last few bells of each, and each anchor's price. One chain
// read for every coin's series, then one for all their rounds.
import { useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { anchorOf, bySymbol, COINS, keyOf, seriesOf, type Anchor, type Coin } from "../../lib/coins";
import { fetchLaddersAt, fetchSeries, type LadderRow } from "../../lib/chain";
import { useLivePrice } from "../../hooks/useChain";

export interface Bell { index: number; settlesAt: number; lo: number; hi: number }

export interface StreetRound {
  coin: Coin;
  /** The feed the rounds settle on here (a stand-in on devnet). */
  anchor: Anchor;
  standIn: boolean;
  seriesKey: PublicKey | null;
  series: stook.SeriesAccount | null;
  /** The next round whose bell is still ahead. */
  index: number | null;
  closesAt: number | null;
  round: LadderRow | null;
  /** Settled rounds still on chain, newest first. */
  bells: Bell[];
}

const BACK = 8; // past days to look at for the last bells

export function useStreetRounds(now: number) {
  const { connection } = useConnection();
  const minute = Math.floor(now / 60);
  return useQuery({
    queryKey: ["home-rounds", minute],
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
    queryFn: async (): Promise<StreetRound[]> => {
      const t = minute * 60;
      const base = await Promise.all(COINS.map(async (coin) => {
        const anchor = anchorOf(coin), seriesKey = seriesOf(coin);
        const series = seriesKey ? await fetchSeries(connection, seriesKey).catch(() => null) : null;
        return { coin, anchor, standIn: anchor.symbol !== coin.anchor.symbol, seriesKey, series };
      }));
      // Every round to read, for every coin, in one call.
      const plan = base.map((b) => {
        if (!b.series || !b.seriesKey) return { next: null as number | null, past: [] as number[], keys: [] as PublicKey[] };
        const s = b.series;
        let next = stook.indexAtOrBefore(s, BigInt(t)) + 1;
        while (!stook.hasRound(s, next) && next < stook.indexAtOrBefore(s, BigInt(t)) + 60) next++;
        const past: number[] = [];
        for (let i = next - 1; past.length < BACK && i > next - 30; i--) if (stook.hasRound(s, i)) past.push(i);
        const keys = [next, ...past].map((index) => stook.deriveLadderPda({ series: b.seriesKey!, index }));
        return { next, past, keys };
      });
      const all = plan.flatMap((p) => p.keys);
      const found = all.length ? await fetchLaddersAt(connection, all) : new Map<string, stook.LadderAccount>();
      return base.map((b, n) => {
        const p = plan[n]!;
        const row = (k: number): LadderRow | null => { const key = p.keys[k]; const l = key && found.get(key.toBase58()); return key && l ? { pubkey: key, ladder: l } : null; };
        const bells: Bell[] = [];
        p.past.forEach((index, k) => {
          const r = row(k + 1)?.ladder;
          if (r?.status !== "settled" || r.settledBin === null || r.p0 <= 0n) return;
          const [lo, hi] = stook.binBounds(r.settledBin, r.p0, r.stepBps);
          const sc = 10 ** r.p0Expo;
          bells.push({ index, settlesAt: Number(r.settlesAt), lo: lo * sc, hi: hi * sc });
        });
        return { ...b, index: p.next, closesAt: b.series && p.next !== null ? Number(stook.closeOf(b.series, p.next)) : null, round: row(0), bells };
      });
    },
  });
}

/** What a round is doing now, for a tag and a button. */
export type Phase = "live" | "locked" | "opening" | "settled" | "void" | "none" | "off";
export function phaseOf(r: StreetRound | undefined, now: number): Phase {
  if (!r?.series) return "off";
  const l = r.round?.ladder;
  if (!l) return "none";
  if (l.status === "open") return now < Number(l.locksAt) ? "live" : "locked";
  if (l.status === "seeding") return "opening";
  return l.status;
}

/** The round the hero asks about: $SSt.'s if it has one here, else the one that locks soonest. */
export function featured(rounds: StreetRound[] | undefined, now: number): StreetRound | undefined {
  if (!rounds) return undefined;
  const sst = rounds.find((r) => keyOf(r.coin) === "STOOK");
  if (sst?.round) return sst;
  const live = rounds.filter((r) => phaseOf(r, now) === "live").sort((a, b) => Number(a.round!.ladder.locksAt - b.round!.ladder.locksAt));
  return live[0] ?? rounds.find((r) => r.round) ?? (sst?.series ? sst : rounds.find((r) => r.series));
}

type Quote = { price: number; change24h: number | null };

/** Anchor prices from /prices, keyed by coin symbol (shared with the rest of the app). */
export const useAnchorQuotes = () =>
  useQuery({ queryKey: ["quotes"], queryFn: async () => bySymbol((await (await fetch("/prices")).json()) as Record<string, Quote>), refetchInterval: 60_000 });

/** The live price of the feed a round settles on, and its 24h move when known. */
export function useFeedQuote(r: StreetRound | undefined): Quote | null {
  const quotes = useAnchorQuotes();
  const feed = useMemo(() => (r?.standIn ? stookFeed(r.anchor.feedId) : null), [r?.standIn, r?.anchor.feedId]);
  const live = useLivePrice(feed);
  const chart = useQuery({
    queryKey: ["hist", r?.anchor.symbol],
    queryFn: async () => (await fetch(`/chart?sym=${r!.anchor.symbol}`)).json() as Promise<{ points: [number, number][] }>,
    enabled: !!r?.standIn,
    refetchInterval: 300_000,
  });
  if (!r) return null;
  if (!r.standIn) return quotes.data?.[r.coin.symbol] ?? null;
  const pts = chart.data?.points ?? [];
  const lp = live.data && live.data.price > 0n ? Number(live.data.price) * 10 ** live.data.expo : null;
  const price = lp ?? pts[pts.length - 1]?.[1] ?? null;
  if (price === null) return null;
  const first = pts[0]?.[1];
  return { price, change24h: first && pts.length > 1 ? (price / first - 1) * 100 : null };
}

const stookFeed = (hex: string) => (hex ? Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16))) : null);

export const fmtAnchor = (v: number, dp: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const fmtChange = (c: number, dp = 2) => `${c >= 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(dp)}%`;

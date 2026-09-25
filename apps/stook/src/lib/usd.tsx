import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { coinByMint } from "./coins";
import { fmtCompact } from "./format";

// Dollars beside coin amounts. Every amount on chain is in the coin; the
// dollar figure is that amount at today's price, so it is shown as an
// estimate (≈) under the coin, except where dollars are the only way to add
// coins up or are what you type. One price per coin, fetched once a minute
// from Jupiter through the site's `/coins` route and shared by every place on
// the page, so no two numbers disagree. The mock USDC is a dollar. Display
// only: nothing on chain reads it.

/** Dollars per whole coin, by symbol, from the same fetch as `useCoinQuotes`. */
export function useUsdRates() {
  const q = useCoinQuotes();
  return { ...q, data: q.data ? Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, v.usd])) as Record<string, number> : undefined };
}

/** Each coin's dollar price and 24h move: the one price source. */
export function useCoinQuotes() {
  return useQuery({
    queryKey: ["coins"],
    queryFn: async () => (await fetch("/coins")).json() as Promise<Record<string, { usd: number; change24h: number | null }>>,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

/** Dollars per whole coin for a round's quote mint, or null if unknown. */
export function useUsdPerCoin(quoteMint: PublicKey | null | undefined, quoteSymbol?: string): number | null {
  const rates = useUsdRates();
  if (!quoteMint) return null;
  const coin = coinByMint(quoteMint);
  if (coin) return rates.data?.[coin.symbol] ?? null;
  return quoteSymbol === "USDC" ? 1 : null;
}

/** Dollars for `units` base units of a coin with `decimals`. */
export const toUsd = (units: bigint, decimals: number, rate: number): number => (Number(units) / 10 ** decimals) * rate;

/** Base units of the coin worth `usd` dollars, rounded down. */
export const fromUsd = (usd: number, decimals: number, rate: number): bigint =>
  rate > 0 && usd > 0 ? BigInt(Math.floor((usd / rate) * 10 ** decimals)) : 0n;

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** A small number the way Jupiter and DexScreener write it: the run of zeros
 *  after the point as a subscript count, then the first digits: 0.0000032378
 *  is "0.0₅324". Numbers from 0.001 up are left as they are. */
export function tiny(a: number, digits = 3): string {
  if (a >= 0.001 || a <= 0) return a.toLocaleString("en-US", { maximumSignificantDigits: digits, maximumFractionDigits: 12 });
  const zeros = Math.floor(-Math.log10(a)); // leading zeros after the point
  const sig = Math.round(a * 10 ** (zeros + digits)).toString().replace(/0+$/, "") || "0";
  return `0.0${String(zeros).split("").map((d) => SUB[+d]).join("")}${sig}`;
}

/** "$1,234.56", "$0.42", "$0.0042", "$0.0₅324" (Jupiter-style under a tenth of a cent), "$0". */
export function fmtUsd(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a === 0) return "$0";
  if (a < 0.001) return `${sign}$${tiny(a)}`;
  if (a < 0.01) return `${sign}$${a.toLocaleString("en-US", { maximumSignificantDigits: 2, maximumFractionDigits: 12 })}`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  return `${sign}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The dollar value of a coin amount, quiet beside it; nothing when the rate is unknown. */
export function Usd({ units, decimals, rate, sign, className }: { units: bigint; decimals: number; rate: number | null; sign?: boolean; className?: string }) {
  if (rate === null) return null;
  const v = toUsd(units, decimals, rate);
  return <span className={`usd ${className ?? ""}`}>{sign && v > 0 ? "+" : ""}{fmtUsd(v)}</span>;
}

/** A coin amount as it stands on chain: "3.26M STOOK". */
export const coinText = (units: bigint, decimals: number, symbol: string): string => `${fmtCompact(units, decimals)} ${symbol}`;

/** Its dollar value today, marked as an estimate: "≈ $20.20", or "" with no price. */
export const approxUsd = (units: bigint, decimals: number, rate: number | null): string => (rate === null ? "" : `≈ ${fmtUsd(toUsd(units, decimals, rate))}`);

/** The coin amount, with its dollar estimate small beneath. */
export function Amount({ units, decimals, symbol, rate, sign = "" }: { units: bigint; decimals: number; symbol: string; rate: number | null; sign?: string }) {
  return <>{sign}{coinText(units, decimals, symbol)}{rate !== null && <small className="approx">{approxUsd(units, decimals, rate)}</small>}</>;
}

import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { coinByMint } from "./coins";

// Dollars beside every coin amount. A coin's price comes from Jupiter
// through the site's `/usd` route (its mainnet mint; the devnet test coins
// are valued as the real ones). The mock USDC is a dollar. Display only:
// nothing on chain reads it.

export function useUsdRates() {
  return useQuery({
    queryKey: ["usd"],
    queryFn: async () => (await fetch("/usd")).json() as Promise<Record<string, number>>,
    refetchInterval: 60_000,
    staleTime: 30_000,
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

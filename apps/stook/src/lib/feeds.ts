// Pyth feeds a market may settle on — every one of them 24/7, because a
// market whose feed goes quiet across its settlement instant cannot settle.
// `Equity.US.*` feeds publish only in market hours and are deliberately NOT
// listed; `Equity.Index.*` are Pyth's round-the-clock prices for the same
// names. Generated from Hermes' catalogue (`scripts/feeds.mjs`), 2026-09-22.
import catalogue from "./feeds.json";

export interface Feed {
  id: string;
  symbol: string;
  name: string;
  kind: "stock" | "crypto";
  /** Decimal places to show. Pyth's exponent is read from the account. */
  dp: number;
}

export const FEEDS: Feed[] = catalogue as Feed[];
export const feedByHex = (hex: string): Feed => FEEDS.find((f) => f.id === hex) ?? { id: hex, symbol: hex.slice(0, 6) + "…", name: "Custom feed", kind: "crypto", dp: 2 };
export const feedHex = (id: Uint8Array) => Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");

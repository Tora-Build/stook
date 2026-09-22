// Pyth feeds a market may settle on. Each id below was checked against the
// push-oracle account devnet keeps for it (2026-09-22). The catalogue behind
// Hermes needs an API key, so the list is short and honest rather than long
// and guessed; a creator may paste any other feed id.

export interface Feed {
  id: string;
  symbol: string;
  name: string;
  /** Decimal places to show. Pyth's exponent is read from the account. */
  dp: number;
}

export const FEEDS: Feed[] = [
  { id: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", symbol: "NVDA", name: "NVIDIA", dp: 2 },
  { id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", symbol: "BTC", name: "Bitcoin", dp: 0 },
  { id: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", symbol: "ETH", name: "Ether", dp: 2 },
  { id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", symbol: "SOL", name: "Solana", dp: 2 },
];

export const feedByHex = (hex: string): Feed => FEEDS.find((f) => f.id === hex) ?? { id: hex, symbol: hex.slice(0, 6) + "…", name: "Custom feed", dp: 2 };
export const feedHex = (id: Uint8Array) => Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("");

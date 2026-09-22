#!/usr/bin/env node
// Regenerate apps/stook/src/lib/feeds.json from Hermes. Needs PYTH_API_KEY.
// Keeps only 24/7 feeds: Equity.Index.* in USD, and a fixed list of majors
// from Crypto.*. Names are curated below; add to NAMES when a new index feed
// appears.
const KEY = process.env.PYTH_API_KEY; if (!KEY) throw new Error("PYTH_API_KEY is not set");
const get = async (t) => (await fetch(`https://hermes.pyth.network/v2/price_feeds?asset_type=${t}`, { headers: { authorization: `Bearer ${KEY}` } })).json();
const [eq, cr] = await Promise.all([get("equity"), get("crypto")]);
const sym = (f) => f.attributes.symbol, base = (f) => sym(f).split(".").pop().split("/")[0];
const NAMES = { TSLA: "Tesla", CRCL: "Circle", MSTR: "Strategy", NVDA: "NVIDIA", HOOD: "Robinhood", COIN: "Coinbase", AAPL: "Apple", AMZN: "Amazon", PLTR: "Palantir", GOOGL: "Alphabet", ORCL: "Oracle", MSFT: "Microsoft", INTC: "Intel", META: "Meta", MU: "Micron", SNDK: "Sandisk", EWY: "iShares South Korea", US500: "S&P 500", US100: "Nasdaq 100", US30: "Dow Jones", SPCX: "SpaceX", ANTHROPIC: "Anthropic", OPENAI: "OpenAI", SOXL: "Semiconductor Bull 3x", SOXS: "Semiconductor Bear 3x", NBIS: "Nebius", SKHY: "SK Hynix", SAMSUNG: "Samsung", JP225: "Nikkei 225", KR200: "KOSPI 200",
  BTC: "Bitcoin", ETH: "Ether", SOL: "Solana", XRP: "XRP", BNB: "BNB", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche", LINK: "Chainlink", SUI: "Sui", HYPE: "Hyperliquid", TRX: "Tron", TON: "Toncoin", DOT: "Polkadot", LTC: "Litecoin", PEPE: "Pepe", WIF: "dogwifhat", BONK: "Bonk", JUP: "Jupiter", PYTH: "Pyth" };
const WANT = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "SUI", "HYPE", "TRX", "TON", "DOT", "LTC", "PEPE", "WIF", "BONK", "JUP", "PYTH"];
const DP = { BTC: 0, PEPE: 7, BONK: 7, DOGE: 4, WIF: 4, ADA: 4, TRX: 4, XRP: 4, JUP: 4, PYTH: 4 };
const stocks = eq.filter((f) => sym(f).startsWith("Equity.Index.") && sym(f).endsWith("/USD")).map((f) => ({ id: f.id, symbol: base(f), name: NAMES[base(f)] ?? base(f), kind: "stock", dp: 2 })).sort((a, b) => a.name.localeCompare(b.name));
const crypto = cr.filter((f) => sym(f) === `Crypto.${base(f)}/USD` && WANT.includes(base(f))).sort((a, b) => WANT.indexOf(base(a)) - WANT.indexOf(base(b))).map((f) => ({ id: f.id, symbol: base(f), name: NAMES[base(f)], kind: "crypto", dp: DP[base(f)] ?? 2 }));
const out = new URL("../apps/stook/src/lib/feeds.json", import.meta.url);
await import("node:fs/promises").then((fs) => fs.writeFile(out, JSON.stringify([...stocks, ...crypto], null, 1) + "\n"));
console.log(`${stocks.length} stocks, ${crypto.length} crypto → ${out.pathname}`);

// Validates the band-width rule AS THE PROGRAM COMPUTES IT.
//
// `explore.py` chose the rule in floating point. This replays the same two
// years of prices through the SDK functions that mirror the program to the
// unit — `bandWidth`, `prior`, the tranche P&L formula — with the series'
// variance updated exactly as `Series::observe` does it (integer EWMA of
// daily log returns between consecutive closes, seeded from the first 30
// days), and reports what a depositor would have lost, per coin, against the
// flat 1% ladder and the fixed-band bell it replaces.
//
// Usage: node validate.mjs DATA_DIR   (one <SYMBOL>.json of [t, close] each)

import { readFileSync } from "node:fs";
import { stook, WAD, lnWad, wadDiv, wadMul } from "@sooth/sdk-solana";

const DATA = process.argv[2];
const DAY = 86_400;
const ASSETS = { "BTC-USD": 20, "ETH-USD": 20, "SOL-USD": 20, "DOGE-USD": 20, "ZEC-USD": 20, SPY: "ny16", GLD: "ny16" };
const FIXED_STEP = { "BTC-USD": 50, "ETH-USD": 100, "SOL-USD": 100, "DOGE-USD": 100, "ZEC-USD": 100, SPY: 25, GLD: 25 };
const VAR_MIN = 1_000_000_000_000n, VAR_MAX = 90_000_000_000_000_000n;

function load(sym) {
  const rows = JSON.parse(readFileSync(`${DATA}/${sym}.json`, "utf8"));
  return { t: rows.map((r) => r[0]), c: rows.map((r) => r[1]) };
}
function priceAt({ t, c }, T) {
  let lo = 0, hi = t.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] < T) { i = m; lo = m + 1; } else hi = m - 1; }
  return i < 0 || T - t[i] > 4 * 3600 ? null : c[i];
}
function closes(sym, d) {
  const out = [];
  const series = { periodSecs: 0, closeSecs: ASSETS[sym] === "ny16" ? 16 * 3600 : ASSETS[sym] * 3600, clock: ASSETS[sym] === "ny16" ? stook.CLOCK_NEW_YORK : stook.CLOCK_UTC };
  for (let day = Math.floor(d.t[0] / DAY) + 1; day < Math.floor(d.t.at(-1) / DAY); day++) {
    if (ASSETS[sym] === "ny16" && [0, 6].includes((day + 4) % 7)) continue;
    out.push(Number(stook.closeOf(series, day)));   // the program's own close
  }
  return out;
}
// `Series::observe`, op for op. Prices as integers at 1e-6.
function observe(s, price, at) {
  if (at <= s.lastAt || price <= 0n) return;
  if (s.lastPrice > 0n) {
    const r = lnWad(wadDiv(price, s.lastPrice));
    const r2 = (wadMul(r, r) * BigInt(DAY)) / BigInt(at - s.lastAt);
    let v = (94n * s.varWad + 6n * (r2 < VAR_MAX ? r2 : VAR_MAX)) / 100n;
    s.varWad = v < VAR_MIN ? VAR_MIN : v > VAR_MAX ? VAR_MAX : v;
  }
  s.lastPrice = price; s.lastAt = at;
}
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
function belief(mu, sd) {
  const q = []; let prev = 0;
  for (let i = 0; i < 64; i++) { const cdf = i === 63 ? 1 : 0.5 * (1 + erf((i - 31 - mu) / (sd * Math.SQRT2))); q.push(Math.max(cdf - prev, 1e-15)); prev = cdf; }
  return q;
}

function run(sym, rule) {
  const d = load(sym), res = [];
  const s = { varWad: 0n, lastPrice: 0n, lastAt: 0 }, seed = [];
  let last = null;
  for (const T of closes(sym, d)) {
    const pc = priceAt(d, T), po = priceAt(d, T - DAY), pl = priceAt(d, T - 3600);
    if (pc == null || po == null || pl == null) continue;
    if (s.varWad === 0n) {
      if (last) seed.push(Math.log(pc / last[1]) ** 2 * DAY / (T - last[0]));
      last = [T, pc];
      if (seed.length >= 30) { s.varWad = BigInt(Math.round(seed.reduce((a, b) => a + b) / seed.length * 1e18)); observe(s, BigInt(Math.round(pc * 1e6)), T); }
      continue;
    }
    // the round: funded ahead, so it opens a day before its close
    let step, curve;
    if (rule === "flat") { step = 100; curve = stook.fresh(); }
    else if (rule === "fixed") { step = FIXED_STEP[sym]; curve = stook.prior(16n * WAD); }
    else { const bw = stook.bandWidth(s.varWad, BigInt(DAY)); step = bw.stepBps; curve = stook.prior(bw.varBands); }
    const p = curve.w.map((w) => Number((w * 10n ** 12n) / curve.sum) / 1e12);
    const pmin = Math.min(...p), bD = 1 / Math.log(1 / pmin);
    const st = step / 1e4;
    const k = Math.min(63, Math.max(0, Math.floor(Math.log(pc / po) / st) + 32));
    const sdGap = Math.sqrt(Number(s.varWad) / 1e18 / 24) / st;
    const q = belief(Math.log(pl / po) / st, sdGap);
    res.push({ pnl: bD * Math.log(p[k] / q[k]), step, k, offGrid: k === 0 || k === 63, kl: Math.log(q[k] / p[k]), bD });
    observe(s, BigInt(Math.round(pc * 1e6)), T);
  }
  return res;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(7);
const q5 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.05)];
console.log(`${"coin".padEnd(9)} ${"rule".padEnd(22)} ${"loss/D".padStart(7)} ${"p5".padStart(7)} ${"KL".padStart(6)} ${"depth/D".padStart(7)} ${"off-grid".padStart(8)} ${"band".padStart(6)} rounds`);
const all = { flat: [], fixed: [], vol: [] };
for (const sym of Object.keys(ASSETS)) {
  for (const [rule, name] of [["flat", "flat 1%"], ["fixed", "fixed band per coin"], ["vol", "volatility (on chain)"]]) {
    const r = run(sym, rule); all[rule].push(...r);
    const steps = r.map((x) => x.step).sort((a, b) => a - b);
    console.log(`${sym.padEnd(9)} ${name.padEnd(22)} ${pct(r.reduce((a, x) => a + x.pnl, 0) / r.length)} ${pct(q5(r.map((x) => x.pnl)))} ${(r.reduce((a, x) => a + x.kl, 0) / r.length).toFixed(2).padStart(6)} ${(r.reduce((a, x) => a + x.bD, 0) / r.length).toFixed(3).padStart(7)} ${pct(r.filter((x) => x.offGrid).length / r.length).padStart(8)} ${String(steps[steps.length >> 1]).padStart(4)}bp ${r.length}`);
  }
}
console.log("");
for (const [rule, r] of Object.entries(all))
  console.log(`ALL       ${rule.padEnd(22)} ${pct(r.reduce((a, x) => a + x.pnl, 0) / r.length)} ${pct(q5(r.map((x) => x.pnl)))} ${(r.reduce((a, x) => a + x.kl, 0) / r.length).toFixed(2).padStart(6)} ${(r.reduce((a, x) => a + x.bD, 0) / r.length).toFixed(3).padStart(7)} ${pct(r.filter((x) => x.offGrid).length / r.length).padStart(8)}        ${r.length}`);

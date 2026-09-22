#!/usr/bin/env node
// The tape. Subscribes to four pool accounts on Solana mainnet and turns every
// state change (every swap) into a price: SPYx/USDC, GLDx/USDC, ZEC/USDC, and
// STONK through STONK/SPYx. Keeps one-minute candles for a week on disk and
// serves them, plus a live stream, on HTTP. This is the number on the tables
// and in the charts. It is NOT the number a round settles on — that is Pyth,
// read by the program on chain — and it never should be: a price this box
// computes is a price this box could lie about.
//
// ENV  PORT (8791)  TAPE_WS_URL  TAPE_RPC_URL  TAPE_FILE (~/stook-tape.json)
//      REGISTER_URL + TAPE_TOKEN  — where to announce this service's public URL

import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 8791);
// Mainnet, always — the pools live there. Named apart from the keeper's devnet RPC_URL.
const WS_URL = process.env.TAPE_WS_URL ?? "wss://solana-rpc.publicnode.com";
const RPC_URL = process.env.TAPE_RPC_URL ?? "https://solana-rpc.publicnode.com";
const FILE = process.env.TAPE_FILE ?? `${homedir()}/stook-tape.json`;

// Pools are identified by account, never by ticker. `quote` names the pool a
// price is expressed through; USDC is the dollar, SPYx resolves through its own pool.
const POOLS = {
  STOOK: { name: "S&P 500 (SPYx)", kind: "clmm", pool: "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE", quote: "USDC", dp: 2 },
  GP: { name: "Gold (GLDx)", kind: "clmm", pool: "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze", quote: "USDC", dp: 2 },
  ZCAT: { name: "Zcash", kind: "whirlpool", pool: "GTHKH8s82ZR8GTSFZ1dUu6wfdxhy59wpMShxzG5zjiPm", quote: "USDC", dp: 2 },
  KNOTS: { name: "STONK", kind: "clmm", pool: "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49", quote: "STOOK", invert: true, dp: 4 },
};

// ── price from pool state ─────────────────────────────────────────────────────
const u128 = (d, o) => Number(d.readBigUInt64LE(o)) + Number(d.readBigUInt64LE(o + 8)) * 2 ** 64;
function poolPrice(kind, d) {
  if (kind === "clmm") {           // Raydium CLMM: token1 per token0
    const o = 8 + 1 + 32 * 7; const dec0 = d[o], dec1 = d[o + 1]; const p = u128(d, o + 2 + 2 + 16) / 2 ** 64;
    return p * p * 10 ** (dec0 - dec1);
  }
  if (kind === "whirlpool") {      // Orca: token B per token A, decimals read from the mints once
    const p = u128(d, 65) / 2 ** 64; return p * p;
  }
  throw new Error("unknown pool kind");
}
const whirlDecimals = {};           // pool → 10^(decA − decB), fetched on start

// ── the tape: latest prices and one-minute candles ───────────────────────────
const latest = {};                   // coin → { price, at, slot }
const candles = {};                  // coin → Map(minute → [t,o,h,l,c,n])
const clients = new Set();
function record(coin, raw, slot) {
  const p = POOLS[coin];
  let price = raw;
  if (p.invert) price = 1 / raw;                                            // STONK per SPYx → SPYx per STONK
  if (p.quote !== "USDC") { const q = latest[p.quote]; if (!q) return; price *= q.price; } // → dollars
  const at = Math.floor(Date.now() / 1000);
  latest[coin] = { price, at, slot };
  const m = Math.floor(at / 60) * 60, book = (candles[coin] ??= new Map());
  const c = book.get(m); if (c) { c[2] = Math.max(c[2], price); c[3] = Math.min(c[3], price); c[4] = price; c[5]++; } else book.set(m, [m, price, price, price, price, 1]);
  for (const k of book.keys()) { if (k < at - 7 * 86_400) book.delete(k); else break; }
  const msg = `data: ${JSON.stringify({ coin, price, at })}\n\n`; for (const res of clients) res.write(msg);
  // a dependent coin re-prices when its quote moves
  for (const [k, q] of Object.entries(POOLS)) if (q.quote === coin && lastRaw[k] != null) record(k, lastRaw[k], slot);
}
const lastRaw = {};

function load() { if (!existsSync(FILE)) return; try { const j = JSON.parse(readFileSync(FILE, "utf8")); for (const [coin, rows] of Object.entries(j.candles ?? {})) candles[coin] = new Map(rows.map((r) => [r[0], r])); Object.assign(latest, j.latest ?? {}); } catch {} }
function save() { writeFileSync(FILE, JSON.stringify({ latest, candles: Object.fromEntries(Object.entries(candles).map(([k, m]) => [k, [...m.values()]])) })); }
load(); setInterval(save, 60_000);

// ── subscriptions ─────────────────────────────────────────────────────────────
const RPCS = [RPC_URL, "https://api.mainnet-beta.solana.com"];
async function rpc(method, params) {
  let err;
  for (const url of RPCS) for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.result !== undefined && j.result !== null) return j.result; err = new Error(`${url}: ${JSON.stringify(j).slice(0, 120)}`); }
    catch (e) { err = e; }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw err;
}
async function prime() {
  for (const [coin, p] of Object.entries(POOLS)) {
    const a = await rpc("getAccountInfo", [p.pool, { encoding: "base64" }]);
    if (!a.value) throw new Error(`${coin}: pool ${p.pool} not found`);
    const d = Buffer.from(a.value.data[0], "base64");
    if (p.kind === "whirlpool") {
      const mints = [new Uint8Array(d.subarray(101, 133)), new Uint8Array(d.subarray(181, 213))].map((b) => bs58(b));
      const infos = await rpc("getMultipleAccounts", [mints, { encoding: "base64" }]);
      const decs = infos.value.map((m) => Buffer.from(m.data[0], "base64")[44]); whirlDecimals[p.pool] = 10 ** (decs[0] - decs[1]);
    }
    const raw = poolPrice(p.kind, d) * (whirlDecimals[p.pool] ?? 1); lastRaw[coin] = raw;
  }
  for (const coin of ["STOOK", "GP", "ZCAT", "KNOTS"]) record(coin, lastRaw[coin], 0);   // quotes first, then STONK through SPYx
}
function subscribe() {
  const ws = new WebSocket(WS_URL); const byId = {}; let id = 0;
  ws.on("open", () => { for (const [coin, p] of Object.entries(POOLS)) { const i = ++id; byId[i] = coin; ws.send(JSON.stringify({ jsonrpc: "2.0", id: i, method: "accountSubscribe", params: [p.pool, { encoding: "base64", commitment: "confirmed" }] })); } console.log("tape: subscribed"); });
  const bySub = {};
  ws.on("message", (buf) => {
    const j = JSON.parse(buf.toString());
    if (j.id && byId[j.id]) { bySub[j.result] = byId[j.id]; return; }
    if (j.method !== "accountNotification") return;
    const coin = bySub[j.params.subscription]; if (!coin) return;
    const d = Buffer.from(j.params.result.value.data[0], "base64"), p = POOLS[coin];
    try { const raw = poolPrice(p.kind, d) * (whirlDecimals[p.pool] ?? 1); lastRaw[coin] = raw; record(coin, raw, j.params.result.context.slot); } catch (e) { console.error(coin, e.message); }
  });
  ws.on("close", () => { console.log("tape: socket closed, reconnecting"); setTimeout(subscribe, 3000); });
  ws.on("error", (e) => console.error("tape: ws", e.message));
  setInterval(() => { if (ws.readyState === 1) ws.ping(); }, 20_000);
}
function bs58(bytes) { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let s = ""; for (; n > 0n; n /= 58n) s = A[Number(n % 58n)] + s; for (const b of bytes) { if (b) break; s = "1" + s; } return s; }

// ── HTTP ─────────────────────────────────────────────────────────────────────
function change24h(coin) { const book = candles[coin]; if (!book) return null; const at = latest[coin]?.at ?? 0; let first = null; for (const [k, c] of book) { if (k >= at - 86_400) { first = c; break; } } return first && latest[coin] ? (latest[coin].price / first[1] - 1) * 100 : null; }
function series(coin, res, from) { const book = candles[coin]; if (!book) return []; const out = []; for (const [k, c] of book) { if (k < from) continue; const b = Math.floor(k / res) * res, last = out[out.length - 1]; if (last && last[0] === b) { last[2] = Math.max(last[2], c[2]); last[3] = Math.min(last[3], c[3]); last[4] = c[4]; last[5] += c[5]; } else out.push([b, c[1], c[2], c[3], c[4], c[5]]); } return out; }
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  if (u.pathname === "/prices") { const out = {}; for (const [coin, l] of Object.entries(latest)) out[coin] = { ...l, change24h: change24h(coin), dp: POOLS[coin].dp, anchor: POOLS[coin].name }; res.writeHead(200, cors); return res.end(JSON.stringify(out)); }
  if (u.pathname === "/candles") { const coin = u.searchParams.get("coin"), r = Number(u.searchParams.get("res") ?? 60), from = Number(u.searchParams.get("from") ?? Math.floor(Date.now() / 1000) - 86_400); res.writeHead(200, cors); return res.end(JSON.stringify({ coin, res: r, candles: series(coin, r, from) })); }
  if (u.pathname === "/stream") { res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" }); res.write(`data: ${JSON.stringify({ hello: latest })}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (u.pathname === "/health") { res.writeHead(200, cors); return res.end(JSON.stringify({ ok: true, coins: Object.keys(latest), clients: clients.size })); }
  res.writeHead(404, cors); res.end("{}");
}).listen(PORT, () => console.log(`tape: http on ${PORT}`));

// ── the way out: a quick tunnel, announced to the Worker ─────────────────────
function tunnel() {
  if (!process.env.REGISTER_URL) return;
  const p = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"]);
  const seen = (line) => { const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (!m) return; console.log("tape: public at", m[0]);
    fetch(process.env.REGISTER_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAPE_TOKEN}` }, body: JSON.stringify({ url: m[0] }) }).then((r) => console.log("tape: registered", r.status)).catch((e) => console.error("tape: register", e.message)); };
  p.stderr.on("data", (b) => b.toString().split("\n").forEach(seen)); p.stdout.on("data", (b) => b.toString().split("\n").forEach(seen));
  p.on("exit", () => setTimeout(tunnel, 5000));
}

await prime(); subscribe(); tunnel();

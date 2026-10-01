#!/usr/bin/env node
// The ledger: every sooth_core transaction read once, turned into rows per
// wallet, and served as a history the app's Yours page shows. Read only: it
// holds no key and sends nothing.
//
// Two loops share one RPC budget: the backfill walks the program's signatures
// newest first down to its first transaction, then stops for good; the poll
// asks every LEDGER_POLL_MS for what is newer than the last signature it
// took, and reads those oldest first. Both cursors are saved, so a restart
// carries on where it left off.
//
// ENV  LEDGER_RPC_URL (https://api.devnet.solana.com)  LEDGER_RPS (3)
//      LEDGER_DIR (~/ledger)  LEDGER_PORT (8792)  LEDGER_HOST (127.0.0.1)
//      LEDGER_POLL_MS (15000)  LEDGER_PROGRAM_ID  LEDGER_STORE (auto|sqlite|jsonl)
//      LEDGER_BACKFILL_MAX (0: all the way; else stop after that many signatures)
//      LEDGER_MINTS / DEVNET_MINTS ({symbol: mint}, see coins.mjs)

import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROGRAM_ID, parseTransaction } from "./decode.mjs";
import { makeRpc } from "./rpc.mjs";
import { openStore } from "./store.mjs";
import { buildHistory, RESULTS } from "./history.mjs";
import { coinBook, loadMints } from "./coins.mjs";
import { isPubkey } from "./b58.mjs";
import { hydrate } from "./hydrate.mjs";

const env = process.env;
const cfg = {
  rpcUrl: env.LEDGER_RPC_URL || "https://api.devnet.solana.com",
  rps: Number(env.LEDGER_RPS) > 0 ? Number(env.LEDGER_RPS) : 3,
  dir: env.LEDGER_DIR || join(homedir(), "ledger"),
  port: Number(env.LEDGER_PORT) || 8792,
  host: env.LEDGER_HOST || "127.0.0.1",
  pollMs: Number(env.LEDGER_POLL_MS) || 15_000,
  programId: env.LEDGER_PROGRAM_ID || PROGRAM_ID,
  backfillMax: Number(env.LEDGER_BACKFILL_MAX) || 0,
  store: env.LEDGER_STORE || "auto",
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

const store = await openStore(cfg.dir, { kind: cfg.store });
const rpc = makeRpc({ url: cfg.rpcUrl, rps: cfg.rps, log });
const coins = coinBook(loadMints(env));
const started = Date.now();
const state = { pollOkAt: 0, pollError: null, backfillError: null, skippedFailed: 0 };
log(`ledger: ${store.kind} store in ${cfg.dir}, ${cfg.rps} req/s, program ${cfg.programId}`);

const COMMITMENT = "finalized";

/** Read one transaction into the store. False when the node has not got it yet. */
async function take(sig) {
  const tx = await rpc.call("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: COMMITMENT }]);
  if (!tx) return false;
  const p = parseTransaction(tx, cfg.programId);
  if (p.skipped === "failed") { state.skippedFailed++; store.apply({ sig }); return true; }
  if (p.skipped) return false;
  store.apply(p);
  return true;
}

const page = (opts) => rpc.call("getSignaturesForAddress", [cfg.programId, { limit: 1000, commitment: COMMITMENT, ...opts }]);

// ── backfill: newest first, down to the program's first transaction ─────────
async function backfill() {
  let bf = store.getKv("backfill") ?? { done: false, tail: null, count: 0 };
  while (!bf.done) {
    const sigs = await page(bf.tail ? { before: bf.tail } : {});
    if (!store.getKv("head") && sigs[0]) store.setKv("head", { sig: sigs[0].signature, time: sigs[0].blockTime });
    for (const s of sigs) {
      if (s.err) { state.skippedFailed++; }
      else if (!(await take(s.signature))) continue;   // not served yet: the poll will see it
      bf = { ...bf, tail: s.signature, tailTime: s.blockTime, count: bf.count + 1 };
      if (bf.count % 50 === 0) store.setKv("backfill", bf);
      if (cfg.backfillMax && bf.count >= cfg.backfillMax) break;
    }
    if (sigs.length < 1000 || (cfg.backfillMax && bf.count >= cfg.backfillMax)) bf.done = true;
    store.setKv("backfill", bf);
    log(`ledger: backfill at ${bf.tailTime ? new Date(bf.tailTime * 1000).toISOString() : "-"}, ${bf.count} read${bf.done ? ", done" : ""}`);
  }
}

// ── poll: what is newer than the head, oldest first ─────────────────────────
async function poll() {
  const head = store.getKv("head");
  if (!head) return;   // the backfill's first page sets it
  const fresh = [];
  let before;
  for (let n = 0; n < 20; n++) {
    const sigs = await page({ until: head.sig, ...(before ? { before } : {}) });
    fresh.push(...sigs);
    if (sigs.length < 1000) break;
    before = sigs[sigs.length - 1].signature;
  }
  for (const s of fresh.reverse()) {
    if (s.err) state.skippedFailed++;
    else if (!(await take(s.signature))) break;   // try again next poll
    store.setKv("head", { sig: s.signature, time: s.blockTime });
  }
}

async function loop(name, fn, everyMs) {
  for (;;) {
    try { await fn(); if (name === "poll") { state.pollOkAt = Date.now(); state.pollError = null; } }
    catch (e) { state[`${name}Error`] = String(e.message ?? e).slice(0, 200); log(`ledger: ${name}: ${state[`${name}Error`]}`); }
    if (!everyMs) {
      if (!state[`${name}Error`]) return;
      await new Promise((r) => setTimeout(r, 30_000));   // the backfill retries until it is done
      state[`${name}Error`] = null;
      continue;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

function health() {
  const head = store.getKv("head"), bf = store.getKv("backfill");
  const pollAge = state.pollOkAt ? Math.round((Date.now() - state.pollOkAt) / 1000) : null;
  const up = (Date.now() - started) / 1000;
  const st = rpc.stats();
  const total = Object.values(st.calls).reduce((a, b) => a + b, 0);
  return {
    ok: pollAge !== null && pollAge < Math.max(120, (cfg.pollMs / 1000) * 8),
    store: store.kind,
    pollAge,
    pollError: state.pollError,
    head: head ? { sig: head.sig, time: head.time } : null,
    backfill: bf ? { done: !!bf.done, read: bf.count, reachedTime: bf.tailTime ?? null, error: state.backfillError } : null,
    skippedFailed: state.skippedFailed,
    counts: store.counts(),
    rpc: { ...st, perDayAtThisRate: Math.round((total / up) * 86_400) },
    uptime: Math.round(up),
  };
}

export function handle(req, res) {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") return json(res, 200, health());
  if (u.pathname === "/history") {
    const wallet = u.searchParams.get("wallet") ?? "";
    if (!isPubkey(wallet)) return json(res, 400, { error: "wallet must be a base58 address" });
    const limit = Math.max(1, Math.min(50, Number(u.searchParams.get("limit")) || 20));
    const before = u.searchParams.get("before");
    if (before && !/^\d{1,12}_[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(before)) return json(res, 400, { error: "bad before" });
    const coin = u.searchParams.get("coin");
    if (coin && !/^[A-Z]{1,10}$/.test(coin) && !isPubkey(coin)) return json(res, 400, { error: "bad coin" });
    const result = u.searchParams.get("result");
    if (result && !RESULTS.includes(result)) return json(res, 400, { error: "bad result" });
    const h = buildHistory({ wallet, rows: store.rowsFor(wallet), round: store.round, series: store.series, coins, limit, before, coin, result });
    const head = store.getKv("head"), bf = store.getKv("backfill");
    return json(res, 200, { ...h, indexed: { through: head?.time ?? null, complete: !!bf?.done } });
  }
  json(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  try { handle(req, res); } catch (e) { log("ledger: http", e.message); if (!res.headersSent) json(res, 500, { error: "internal" }); else res.end(); }
});
server.listen(cfg.port, cfg.host, () => log(`ledger: http on ${cfg.host}:${cfg.port}`));

const stop = () => { log("ledger: stopping"); server.close(); store.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// Rounds whose events the ledger has not seen (a partial backfill, a
// truncated log) are filled in from their accounts, once the backfill is done.
const hydrated = new Map();
async function fill() {
  const bf = store.getKv("backfill");
  if (!bf?.done) return;
  const n = await hydrate({ store, rpc, programId: cfg.programId, seen: hydrated, now: Math.floor(Date.now() / 1000) });
  if (n) log(`ledger: filled ${n} rounds or series from their accounts`);
}

void loop("backfill", backfill, 0);
void loop("fill", fill, 10 * 60_000);
void loop("poll", poll, cfg.pollMs);

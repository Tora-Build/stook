// Where the ledger keeps what it has read: rows by wallet, round and series
// facts, and the cursors. SQLite (node:sqlite, Node 22.5+; before 22.13 it
// needs --experimental-sqlite) when the runtime has it, else an append-only
// JSONL file replayed into memory on start. Both are written so that reading
// the same transaction twice changes nothing.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const merge = (a, b) => {
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) if (v !== undefined && v !== null) out[k] = v;
  return out;
};
const rowKey = (r) => `${r.sig}:${r.ix}:${r.sub}`;

export async function openStore(dir, { kind = "auto" } = {}) {
  mkdirSync(dir, { recursive: true });
  if (kind !== "jsonl") {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      return sqliteStore(new DatabaseSync(join(dir, "ledger.db")));
    } catch (e) {
      if (kind === "sqlite") throw e;
    }
  }
  return jsonlStore(dir);
}

function sqliteStore(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS rows (sig TEXT NOT NULL, ix INTEGER NOT NULL, sub INTEGER NOT NULL, wallet TEXT NOT NULL, ladder TEXT NOT NULL, slot INTEGER, json TEXT NOT NULL, PRIMARY KEY (sig, ix, sub));
    CREATE INDEX IF NOT EXISTS rows_wallet ON rows (wallet);
    CREATE TABLE IF NOT EXISTS rounds (ladder TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS series (series TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seen (sig TEXT PRIMARY KEY);
  `);
  const q = {
    row: db.prepare("INSERT OR REPLACE INTO rows (sig, ix, sub, wallet, ladder, slot, json) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    getRound: db.prepare("SELECT json FROM rounds WHERE ladder = ?"),
    putRound: db.prepare("INSERT OR REPLACE INTO rounds (ladder, json) VALUES (?, ?)"),
    getSeries: db.prepare("SELECT json FROM series WHERE series = ?"),
    putSeries: db.prepare("INSERT OR REPLACE INTO series (series, json) VALUES (?, ?)"),
    getKv: db.prepare("SELECT json FROM kv WHERE key = ?"),
    putKv: db.prepare("INSERT OR REPLACE INTO kv (key, json) VALUES (?, ?)"),
    byWallet: db.prepare("SELECT json FROM rows WHERE wallet = ? ORDER BY slot, ix, sub"),
    seen: db.prepare("INSERT OR IGNORE INTO seen (sig) VALUES (?)"),
    allRounds: db.prepare("SELECT ladder, json FROM rounds"),
    counts: db.prepare("SELECT (SELECT count(*) FROM rows) AS rows, (SELECT count(*) FROM rounds) AS rounds, (SELECT count(*) FROM seen) AS txs, (SELECT count(DISTINCT wallet) FROM rows) AS wallets"),
  };
  const get = (stmt, k) => { const r = stmt.get(k); return r ? JSON.parse(r.json) : null; };
  return {
    kind: "sqlite",
    apply(p) {
      db.exec("BEGIN");
      try {
        for (const r of p.rows ?? []) q.row.run(r.sig, r.ix, r.sub, r.wallet, r.ladder, r.slot, JSON.stringify(r));
        for (const [k, v] of Object.entries(p.rounds ?? {})) q.putRound.run(k, JSON.stringify(merge(get(q.getRound, k), v)));
        for (const [k, v] of Object.entries(p.series ?? {})) q.putSeries.run(k, JSON.stringify(merge(get(q.getSeries, k), v)));
        if (p.sig) q.seen.run(p.sig);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    rowsFor: (wallet) => q.byWallet.all(wallet).map((r) => JSON.parse(r.json)),
    round: (k) => get(q.getRound, k),
    series: (k) => get(q.getSeries, k),
    rounds: () => q.allRounds.all().map((r) => [r.ladder, JSON.parse(r.json)]),
    getKv: (k) => get(q.getKv, k),
    setKv: (k, v) => { q.putKv.run(k, JSON.stringify(v)); },
    counts: () => ({ ...q.counts.get() }),
    close: () => db.close(),
  };
}

function jsonlStore(dir) {
  const file = join(dir, "ledger.jsonl"), kvFile = join(dir, "cursor.json");
  const byWallet = new Map(), rounds = new Map(), series = new Map(), seen = new Set();
  let kv = {};
  const ingest = (p) => {
    for (const r of p.rows ?? []) { const m = byWallet.get(r.wallet) ?? new Map(); m.set(rowKey(r), r); byWallet.set(r.wallet, m); }
    for (const [k, v] of Object.entries(p.rounds ?? {})) rounds.set(k, merge(rounds.get(k), v));
    for (const [k, v] of Object.entries(p.series ?? {})) series.set(k, merge(series.get(k), v));
    if (p.sig) seen.add(p.sig);
  };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try { ingest(JSON.parse(line)); } catch { /* a torn last line from a crash */ }
    }
  }
  try { kv = JSON.parse(readFileSync(kvFile, "utf8")); } catch { kv = {}; }
  return {
    kind: "jsonl",
    apply(p) {
      const slim = { sig: p.sig, rows: p.rows ?? [], rounds: p.rounds ?? {}, series: p.series ?? {} };
      appendFileSync(file, JSON.stringify(slim) + "\n");
      ingest(slim);
    },
    rowsFor: (wallet) => [...(byWallet.get(wallet)?.values() ?? [])].sort((a, b) => a.slot - b.slot || a.ix - b.ix || a.sub - b.sub),
    round: (k) => rounds.get(k) ?? null,
    series: (k) => series.get(k) ?? null,
    rounds: () => [...rounds.entries()],
    getKv: (k) => kv[k] ?? null,
    setKv: (k, v) => { kv[k] = v; writeFileSync(kvFile + ".tmp", JSON.stringify(kv)); renameSync(kvFile + ".tmp", kvFile); },
    counts: () => ({ rows: [...byWallet.values()].reduce((a, m) => a + m.size, 0), rounds: rounds.size, txs: seen.size, wallets: byWallet.size }),
    close: () => {},
  };
}

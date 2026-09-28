// The fleet's files in SIM_DIR: the action log (JSONL, rotated by size),
// the issue book (one line per unexpected failure class), small JSON state
// written whole through a rename so a crash never leaves half a file, and
// the lock that keeps a second run off the same state.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function writeJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), { mode });
  renameSync(tmp, path);
}

/** Append-only JSONL, rotated to `.1` … `.keep` once it passes `maxBytes`. */
export class JsonlLog {
  constructor(path, { maxBytes = 20 * 1024 * 1024, keep = 3 } = {}) {
    this.path = path; this.maxBytes = maxBytes; this.keep = keep;
    try { this.size = statSync(path).size; } catch { this.size = 0; }
  }
  append(obj) {
    const line = `${JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`;
    if (this.size + line.length > this.maxBytes) this.rotate();
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, line, { mode: 0o600 });
    this.size += Buffer.byteLength(line);
  }
  rotate() {
    try {
      const last = `${this.path}.${this.keep}`;
      if (existsSync(last)) unlinkSync(last);
      for (let n = this.keep - 1; n >= 1; n--) if (existsSync(`${this.path}.${n}`)) renameSync(`${this.path}.${n}`, `${this.path}.${n + 1}`);
      if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
    } catch { /* a failed rotation only means a longer file */ }
    this.size = 0;
  }
}

/**
 * Unexpected failures by signature: a count, first and last seen, and one
 * example. The whole book is rewritten on each record; it stays small
 * (at most `max` classes, the least recent dropped).
 */
export class IssueBook {
  constructor(path, { max = 500 } = {}) {
    this.path = path; this.max = max; this.byHash = new Map();
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) if (line.trim()) { const r = JSON.parse(line); this.byHash.set(r.hash, r); }
    } catch { /* a new book */ }
  }
  /** Count one failure; says whether its class is new. */
  record(c, example, at = new Date().toISOString()) {
    const had = this.byHash.get(c.hash);
    if (had) { had.count++; had.lastSeen = at; }
    else this.byHash.set(c.hash, { hash: c.hash, signature: c.signature, name: c.name, count: 1, firstSeen: at, lastSeen: at, example });
    if (this.byHash.size > this.max) {
      const oldest = [...this.byHash.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : 1))[0];
      this.byHash.delete(oldest.hash);
    }
    this.save();
    return !had;
  }
  top(n = 5) { return [...this.byHash.values()].sort((a, b) => b.count - a.count).slice(0, n); }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, [...this.byHash.values()].map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };

/**
 * The run's hold on SIM_DIR: a file with this process's id, made only if
 * absent (or left by a process that is gone). Null when another live run
 * holds it; two runs would keep two budgets and two minute caps, and the
 * later write of state.json would lose the other's spend.
 */
export function takeLock(path, pid = process.pid) {
  mkdirSync(dirname(path), { recursive: true });
  for (let n = 0; n < 2; n++) {
    try {
      writeFileSync(path, String(pid), { flag: "wx", mode: 0o600 });
      return { release: () => { try { if (readFileSync(path, "utf8") === String(pid)) unlinkSync(path); } catch { /* gone already */ } } };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      const held = Number(readFileSync(path, "utf8"));
      if (held && held !== pid && alive(held)) return null;
      try { unlinkSync(path); } catch { /* raced */ }
    }
  }
  return null;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.mjs";

const W = "F2X8tU1JGBh3h4ZfALW41DCggk8MrwiNtM4gL97dxg4M";
const r = (sig, slot, extra = {}) => ({ sig, ix: 1, sub: 0, slot, time: slot, wallet: W, ladder: "L", kind: "buy", amountIn: "5", ...extra });

let sqliteOk = true;
try { await import("node:sqlite"); } catch { sqliteOk = false; }

for (const kind of ["sqlite", "jsonl"]) {
  test(`${kind}: idempotent, merges round facts in any order, survives a reopen`, { skip: kind === "sqlite" && !sqliteOk && "no node:sqlite here" }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    try {
      let s = await openStore(dir, { kind });
      assert.equal(s.kind, kind);
      // newest first, as the backfill reads: the settle before the create
      s.apply({ sig: "b", rows: [r("b", 20)], rounds: { L: { settled: { bin: 3 } } } });
      s.apply({ sig: "a", rows: [r("a", 10)], rounds: { L: { settlesAt: 99, series: "S" } }, series: { S: { feedId: "ff" } } });
      s.apply({ sig: "a", rows: [r("a", 10)], rounds: { L: { settlesAt: 99, series: "S" } } });   // read twice
      s.apply({ rounds: { L: { decimals: 0, quoteMint: null } } });                             // a zero is a fact, a null is not
      assert.deepEqual(s.rowsFor(W).map((x) => x.sig), ["a", "b"]);
      assert.deepEqual(s.round("L"), { settled: { bin: 3 }, settlesAt: 99, series: "S", decimals: 0 });
      assert.equal(s.series("S").feedId, "ff");
      s.setKv("head", { sig: "b" });
      assert.deepEqual(s.counts(), { rows: 2, rounds: 1, txs: 2, wallets: 1 });
      s.close();
      s = await openStore(dir, { kind });
      assert.equal(s.rowsFor(W).length, 2);
      assert.equal(s.getKv("head").sig, "b");
      assert.equal(s.round("L").settlesAt, 99);
      assert.deepEqual(s.rowsFor("nobody"), []);
      s.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

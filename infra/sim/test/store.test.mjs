// One run at a time holds SIM_DIR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeLock } from "../src/store.mjs";

test("a second run is refused while the first holds the lock; a dead holder's lock is taken over", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sim-lock-")), "lock");
  const a = takeLock(path);
  assert.ok(a);
  // The test process itself is alive: another id claiming it is refused.
  writeFileSync(path, String(process.pid));
  assert.equal(takeLock(path, process.pid + 1), null);
  a.release();
  assert.equal(existsSync(path), false);
  // A lock left by a process that is gone.
  writeFileSync(path, "2147483646");
  const b = takeLock(path);
  assert.ok(b);
  b.release();
});

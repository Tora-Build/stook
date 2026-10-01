import { test } from "node:test";
import assert from "node:assert/strict";
import { lacks, sane } from "../src/hydrate.mjs";

test("what a round still lacks", () => {
  const now = 1_800_000_000;
  assert.equal(lacks({ quoteMint: "M" }, now), "terms");
  const terms = { series: "S", settlesAt: now - 10, opensAt: now - 90_000, quoteMint: "M", decimals: 6 };
  assert.equal(lacks(terms, now), "grid");
  assert.equal(lacks({ ...terms, p0: "1" }, now), null, "within the hour after the close: the settle may still come");
  assert.equal(lacks({ ...terms, p0: "1", settlesAt: now - 7200 }, now), "outcome");
  assert.equal(lacks({ ...terms, p0: "1", settlesAt: now - 7200, closed: { sig: "c" } }, now), null, "a closed round has no account to read");
});

test("an account of an earlier layout is not taken for facts", () => {
  assert.equal(sane({ settlesAt: 1_790_000_000, opensAt: 1_789_990_000, decimals: 6, stepBps: 100 }), true);
  assert.equal(sane({ settlesAt: -4_079_353_579_620_105_000, opensAt: 0, decimals: 6 }), false);
  assert.equal(sane({ settlesAt: 1_790_000_000, opensAt: 1_789_990_000, decimals: 200 }), false);
});

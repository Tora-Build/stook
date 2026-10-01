import { test } from "node:test";
import assert from "node:assert/strict";
import { bandName, buildHistory, callName, level, summarize } from "../src/history.mjs";
import { coinBook } from "../src/coins.mjs";
import { stook } from "@sooth/sdk-solana";

const W = "F2X8tU1JGBh3h4ZfALW41DCggk8MrwiNtM4gL97dxg4M";
const BTC = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const MINT = "9Bq5sM5xUCZbzk5nWNgYzCZ7xGXndTkriPfmoArBWpgS";
const coins = coinBook({ STOOK: MINT });
const grid = { p0: "6500000000000", expo: -8, stepBps: 100 };   // 65,000 at the centre, 1% floors
const series = { S1: { feedId: BTC, quoteMint: MINT } };

// a floor's bottom edge from the SDK's own binBounds, as the app draws it
const E = (k) => (stook.binBounds(k, BigInt(grid.p0), grid.stepBps)[0] * 1e-8).toLocaleString("en-US", { maximumFractionDigits: 0 });

let n = 0;
const row = (o) => ({ sig: `sig${++n}`, ix: 0, sub: 0, slot: n, time: 1_790_000_000 + n, wallet: W, by: null, mint: MINT, decimals: 6, lo: null, hi: null, h: null, shares: null, position: null, tranche: null, amountIn: "0", amountOut: "0", fee: "0", ...o });
const buy = (ladder, shape, shares, paid, position) => row({ ladder, kind: "buy", ...shape, shares: String(shares), amountIn: String(paid), position });
const round = (o) => ({ series: "S1", settlesAt: 1_790_100_000, quoteMint: MINT, decimals: 6, ...grid, ...o });

test("level is the program's Shape::level", () => {
  const tent = { lo: 29, hi: 35, h: 4 };
  assert.deepEqual([28, 29, 30, 31, 32, 33, 34, 35, 36].map((i) => level(tent, i)), [0, 1, 2, 3, 4, 3, 2, 1, 0]);
  assert.equal(level({ lo: 30, hi: 40, h: 1 }, 40), 1);
});

test("calls are named as the app's rack names them", () => {
  assert.equal(callName({ lo: 29, hi: 35, h: 4 }, grid, 0), "Near 65,000 ±3");
  assert.equal(callName({ lo: 32, hi: 33, h: 1 }, grid, 0), `Between 65,000 and ${E(34)}`);
  assert.equal(E(34), "66,313");
  assert.equal(callName({ lo: 40, hi: 63, h: 1 }, grid, 0), `Above ${E(40)}`);
  assert.equal(callName({ lo: 0, hi: 20, h: 1 }, grid, 0), `Below ${E(21)}`);
  assert.equal(callName({ lo: 0, hi: 63, h: 1 }, grid, 0), "Anywhere");
  assert.equal(callName({ lo: 30, hi: 34, h: 3 }, null, 0), "Near floor 32 ±2");
  assert.equal(bandName(32, grid, 0), `65,000 to ${E(33)}`);
  assert.equal(bandName(63, grid, 0), `above ${E(63)}`);
});

test("a won round: call, add, collect; the second buy of the same call is an add", () => {
  const L = "L1";
  const rows = [
    buy(L, { lo: 29, hi: 35, h: 4 }, 1_000_000, 400_000, "P1"),
    buy(L, { lo: 29, hi: 35, h: 4 }, 500_000, 210_000, "P1"),
    buy(L, { lo: 40, hi: 45, h: 1 }, 300_000, 90_000, "P2"),
    row({ ladder: L, kind: "redeem", position: "P1", amountOut: "4500000" }),
    row({ ladder: L, kind: "sweep", position: "P2", by: "Keeper111111111111111111111111111111111111" }),
  ];
  const s = summarize(L, rows, round({ settled: { price: "6500100000000", expo: -8, bin: 32, time: 1, sig: "set" } }), series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "won");
  assert.deepEqual(s.actions.filter((a) => a.kind !== "settle").map((a) => a.kind), ["call", "add", "call", "collect", "sweep"]);
  assert.equal(s.paid, "700000"); assert.equal(s.got, "4500000"); assert.equal(s.net, "3800000");
  assert.equal(s.coin, "STOOK");
  assert.deepEqual(s.calls, ["Near 65,000 ±3", `Between ${E(40)} and ${E(46)}`]);
  assert.equal(s.settled.band, `65,000 to ${E(33)}`);
  // the sweep keeps its shape from the position it closed
  assert.equal(s.actions.find((a) => a.kind === "sweep").name, `Between ${E(40)} and ${E(46)}`);
});

test("unclaimed: a winning call not yet redeemed; owed is shares times level", () => {
  const rows = [buy("L2", { lo: 29, hi: 35, h: 4 }, 1_000_000, 400_000, "P1")];
  const s = summarize("L2", rows, round({ settled: { price: "1", expo: -8, bin: 31, time: 1, sig: "x" } }), series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "unclaimed"); assert.equal(s.owed, "3000000"); assert.equal(s.claimable, true);
});

test("missed: nothing it called paid, swept by a keeper", () => {
  const rows = [buy("L3", { lo: 40, hi: 41, h: 1 }, 100, 50, "P1"), row({ ladder: "L3", kind: "sweep", position: "P1", by: "K" })];
  const s = summarize("L3", rows, round({ settled: { price: "1", expo: -8, bin: 31, time: 1, sig: "x" } }), series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "missed"); assert.equal(s.net, "-50");
});

test("missed even without a sweep: a losing call owes nothing", () => {
  const s = summarize("L3b", [buy("L3b", { lo: 40, hi: 41, h: 1 }, 100, 50, "P1")], round({ settled: { price: "1", expo: -8, bin: 31, time: 1, sig: "x" } }), series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "missed");
});

test("void: refund rows, then refunded; an unredeemed call keeps it unclaimed", () => {
  const rows = [buy("L4", { lo: 30, hi: 34, h: 1 }, 100, 50, "P1"), row({ ladder: "L4", kind: "redeem", position: "P1", amountOut: "50" })];
  const voided = round({ voided: { time: 1, sig: "v" }, p0: null });
  const s = summarize("L4", rows, voided, series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "refunded");
  assert.equal(s.actions.find((a) => a.amountOut === "50").kind, "refund");
  const open = summarize("L4", rows.slice(0, 1), voided, series.S1, coins, 1_800_000_000);
  assert.equal(open.result, "unclaimed");
});

test("open and house rounds", () => {
  const live = summarize("L5", [buy("L5", { lo: 30, hi: 34, h: 1 }, 100, 50, "P1")], round({}), series.S1, coins, 1_790_000_100);
  assert.equal(live.result, "open"); assert.equal(live.status, "open");
  const house = [row({ ladder: "L6", kind: "start", tranche: 0, amountIn: "1000" }), row({ ladder: "L6", kind: "deposit", tranche: 1, amountIn: "500" })];
  const settled = round({ settled: { price: "1", expo: -8, bin: 31, time: 1, sig: "x" } });
  assert.equal(summarize("L6", house, settled, series.S1, coins, 1_800_000_000).result, "unclaimed");
  const claimed = [...house, row({ ladder: "L6", kind: "claim", tranche: 0, amountOut: "1100" }), row({ ladder: "L6", kind: "claim", tranche: 1, amountOut: "520" }), row({ ladder: "L6", kind: "fees", amountOut: "30" })];
  const s = summarize("L6", claimed, settled, series.S1, coins, 1_800_000_000);
  assert.equal(s.result, "won"); assert.equal(s.net, "150"); assert.equal(s.house, true);
});

test("pages, the cursor, and the filters", () => {
  const rows = [], rounds = {};
  for (let i = 0; i < 25; i++) {
    const L = `R${String(i).padStart(2, "0")}`;
    rounds[L] = round({ settlesAt: 1_790_000_000 + i * 86_400, ...(i % 2 ? { settled: { price: "1", expo: -8, bin: 31, time: 1, sig: "x" } } : { voided: { time: 1, sig: "v" } }) });
    rows.push(buy(L, { lo: 40, hi: 41, h: 1 }, 100, 50, `P${i}`));
    if (i % 2 === 0) rows.push(row({ ladder: L, kind: "redeem", position: `P${i}`, amountOut: "50" }));
  }
  const args = { wallet: W, rows, round: (k) => rounds[k], series: (k) => series[k], coins, now: 1_800_000_000 };
  const p1 = buildHistory({ ...args, limit: 10 });
  assert.equal(p1.rounds.length, 10); assert.equal(p1.rounds[0].ladder, "R24"); assert.ok(p1.next);
  assert.equal(p1.totals.rounds, 25); assert.equal(p1.totals.results.refunded, 13); assert.equal(p1.totals.results.missed, 12);
  assert.equal(p1.totals.coins[0].paid, String(25 * 50)); assert.equal(p1.totals.coins[0].net, String(-12 * 50));
  const p2 = buildHistory({ ...args, limit: 10, before: p1.next });
  assert.equal(p2.rounds[0].ladder, "R14");
  const p3 = buildHistory({ ...args, limit: 10, before: buildHistory({ ...args, limit: 10, before: p1.next }).next });
  assert.equal(p3.rounds.length, 5); assert.equal(p3.next, null);
  const live = buildHistory({ ...args, now: 1_790_000_000 - 1, round: (k) => ({ ...rounds[k], settled: null, voided: null }), rows: rows.filter((x) => x.kind === "buy") });
  assert.equal(live.totals.coins[0].paid, "0", "a running round is not counted as paid out");
  assert.equal(live.totals.coins[0].atWork, String(25 * 50));
  const missed = buildHistory({ ...args, result: "missed" });
  assert.equal(missed.matching, 12); assert.ok(missed.rounds.every((r) => r.result === "missed"));
  assert.equal(missed.totals.rounds, 25, "totals ignore the result filter");
  assert.equal(buildHistory({ ...args, coin: "ZCAT" }).totals.rounds, 0);
  assert.equal(buildHistory({ ...args, coin: MINT }).totals.rounds, 25);
});

test("a round whose settle the ledger never saw: finished once it paid out or closed", () => {
  const rows = [buy("L7", { lo: 30, hi: 34, h: 1 }, 100, 50, "P1"), row({ ladder: "L7", kind: "redeem", position: "P1", amountOut: "100" })];
  const s = summarize("L7", rows, round({ closed: { time: 1, sig: "c" } }), series.S1, coins, 1_800_000_000);
  assert.equal(s.status, "settled"); assert.equal(s.settled, null); assert.equal(s.result, "won");
  const lost = summarize("L8", [buy("L8", { lo: 30, hi: 34, h: 1 }, 100, 50, "P1"), row({ ladder: "L8", kind: "sweep", position: "P1" })], round({ closed: { time: 1, sig: "c" } }), series.S1, coins, 1_800_000_000);
  assert.equal(lost.result, "missed");
});

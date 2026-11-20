import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL, buildBoard, loadBots, pointsFor, weekOf } from "../src/board.mjs";
import { coinBook } from "../src/coins.mjs";

const BTC = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const MINT = "9Bq5sM5xUCZbzk5nWNgYzCZ7xGXndTkriPfmoArBWpgS", OTHER = "So11111111111111111111111111111111111111112";
const coins = coinBook({ STOOK: MINT, KNOTS: OTHER });
const grid = { p0: "6500000000000", expo: -8, stepBps: 100 };
const series = (k) => ({ S1: { feedId: BTC, quoteMint: MINT } })[k] ?? null;
const settled = (bin, settlesAt = 1_790_100_000, mint = MINT) => ({ series: "S1", settlesAt, quoteMint: mint, decimals: 6, ...grid, settled: { price: "6500000000000", expo: -8, bin, time: 1, sig: "s" } });

let n = 0;
const row = (wallet, o) => ({ sig: `sig${++n}`, ix: 0, sub: 0, slot: n, time: 1_790_000_000 + n, wallet, by: null, mint: MINT, decimals: 6, lo: null, hi: null, h: null, shares: null, position: null, tranche: null, amountIn: "0", amountOut: "0", fee: "0", ...o });
const call = (wallet, ladder, shape, shares, paid, position) => row(wallet, { ladder, kind: "buy", ...shape, shares: String(shares), amountIn: String(paid), position });
const redeem = (wallet, ladder, position, got) => row(wallet, { ladder, kind: "redeem", position, amountOut: String(got) });

const NEAR = { lo: 30, hi: 34, h: 3 };   // pays on floors 30 to 34
const rounds = { L1: settled(32), L2: settled(10), L3: settled(32, 1_790_900_000), LV: { ...settled(32), settled: undefined, voided: { time: 1, sig: "v" } }, LK: settled(32, 1_790_100_000, OTHER) };
const ctx = { round: (k) => rounds[k] ?? null, series, coins, now: 1_800_000_000 };

test("callers rank by net, a call still to collect counts as won, voids and house-only rounds count for nothing", () => {
  const A = "A".repeat(43), B = "B".repeat(43), C = "C".repeat(43), D = "D".repeat(43);
  const walletRows = new Map([
    // A: won L1 (collected), missed L2
    [A, [call(A, "L1", NEAR, 1_000_000, 400_000, "a1"), redeem(A, "L1", "a1", 3_000_000), call(A, "L2", NEAR, 1_000_000, 500_000, "a2")]],
    // B: won L3 and has not collected it (owed 1,000,000 shares × level 3 at floor 32)
    [B, [call(B, "L3", NEAR, 1_000_000, 100_000, "b1")]],
    // C: a void and a house deposit only: not on the board
    [C, [call(C, "LV", NEAR, 1_000_000, 100_000, "c1"), row(C, { ladder: "L1", kind: "deposit", tranche: 1, amountIn: "5000000" })]],
    // D: a call in another coin: not on this coin's board
    [D, [call(D, "LK", NEAR, 1_000_000, 100_000, "d1")]],
  ]);
  const bots = new Map([[A, "caller"]]);
  const b = buildBoard({ walletRows, ...ctx, bots, coin: "STOOK" });
  assert.equal(b.players, 2);
  assert.equal(b.people, 1);
  assert.deepEqual(b.board.map((p) => [p.wallet, p.rank, p.rounds, p.won, p.net]), [[B, 1, 1, 1, "2900000"], [A, 2, 2, 1, "2100000"]]);
  assert.equal(b.board[0].wallet, B, "B's uncollected win is worth more than A's record");
  assert.equal(b.board[1].bot, "caller");
  assert.equal(b.board[1].hit, 0.5);
  assert.equal(b.board[1].best, "2600000");
  assert.deepEqual(b.peopleBoard.map((p) => [p.wallet, p.rank]), [[B, 1]]);
  assert.equal(b.decimals, 6);

  // the last seven days only: L3 settles after the cut, L1 and L2 before
  const week = buildBoard({ walletRows, ...ctx, coin: "STOOK", since: 1_790_500_000 });
  assert.deepEqual(week.board.map((p) => p.wallet), [B]);
});

test("the sim's wallet list marks bots", () => {
  const dir = mkdtempSync(join(tmpdir(), "bots-"));
  writeFileSync(join(dir, "wallets.txt"), "# index\tpublic key\tpersona\tsize\tstate\n0\tKey1\tcaller\tmedium\t\n1\tKey2\thouse\tsmall\tretiring\n");
  const bots = loadBots({ SIM_DIR: dir });
  assert.deepEqual([...bots], [["Key1", "caller"], ["Key2", "house"]]);
  assert.equal(loadBots({ SIM_DIR: join(dir, "none") }).size, 0);
});

test("a round is worth 10 to 100 points: 10 played, 30 for a win, 1 for each 5% returned up to 60", () => {
  assert.equal(pointsFor({ won: false, paid: 100n, back: 0n }), 10);
  assert.equal(pointsFor({ won: true, paid: 100n, back: 104n }), 40, "a 4% return earns no edge points");
  assert.equal(pointsFor({ won: true, paid: 100n, back: 300n }), 80, "200% returned: 40 edge points");
  assert.equal(pointsFor({ won: true, paid: 100n, back: 10_000n }), 100, "the edge stops at 60");
});

test("the all-coins board ranks by points and keeps each coin's net apart", () => {
  const A = "A".repeat(43), D = "D".repeat(43);
  const walletRows = new Map([
    // A: won L1 (+2.6 STOOK, 200% and more: 100 points) and missed L2 (10)
    [A, [call(A, "L1", NEAR, 1_000_000, 400_000, "a1"), redeem(A, "L1", "a1", 3_000_000), call(A, "L2", NEAR, 1_000_000, 500_000, "a2")]],
    // D: one win in the other coin, paid 100,000 back 3,000,000: 100 points
    [D, [call(D, "LK", NEAR, 1_000_000, 100_000, "d1")]],
  ]);
  const b = buildBoard({ walletRows, ...ctx, coin: ALL });
  assert.equal(b.decimals, null);
  assert.deepEqual(b.board.map((p) => [p.wallet, p.points, p.rounds]), [[A, 110, 2], [D, 100, 1]]);
  assert.deepEqual(b.board[0].coins, { STOOK: { net: "2100000", decimals: 6 } });
  assert.deepEqual(b.board[1].coins, { KNOTS: { net: "2900000", decimals: 6 } });
  assert.equal(b.board[0].net, undefined, "no net across coins");
  // a coin's own board carries the points too, still ranked by net
  assert.equal(buildBoard({ walletRows, ...ctx, coin: "STOOK" }).board[0].points, 110);
});

test("prize weeks end at the Friday bell, 4 PM New York, in winter and summer time", () => {
  const iso = (t) => new Date(t * 1000).toISOString();
  const now = Date.parse("2026-11-20T12:00:00Z") / 1000; // a Friday morning
  const w0 = weekOf(0, now), w1 = weekOf(1, now), w3 = weekOf(3, now);
  assert.deepEqual([iso(w0.from), iso(w0.to)], ["2026-11-13T21:00:00.000Z", "2026-11-20T21:00:00.000Z"]);
  assert.equal(w1.to, w0.from);
  assert.deepEqual([iso(w3.from), iso(w3.to)], ["2026-10-23T20:00:00.000Z", "2026-10-30T20:00:00.000Z"], "before Nov 1 the bell is 20:00 UTC");
  assert.equal(weekOf(0, Date.parse("2026-11-20T21:00:00Z") / 1000).to, w0.to, "the bell itself closes its week");
  assert.equal(iso(weekOf(0, Date.parse("2026-11-20T21:00:01Z") / 1000).to), "2026-11-27T21:00:00.000Z");
});

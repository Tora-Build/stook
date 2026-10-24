import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBoard, loadBots } from "../src/board.mjs";
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

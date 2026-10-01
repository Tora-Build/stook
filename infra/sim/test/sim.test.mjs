// The fleet against mocks: plan mode builds turns and sends nothing, a real
// turn goes out with the heap frame first, and the logs stay bounded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { createSender, PlanRefusal } from "../src/chain.mjs";
import { createSim } from "../src/sim.mjs";
import { parseArgs } from "../src/index.mjs";
import { rngFrom } from "../src/personas.mjs";
import { TxWindow } from "../src/rate.mjs";
import { IssueBook, JsonlLog } from "../src/store.mjs";
import { classify } from "../src/classify.mjs";
import { loadFleet } from "../src/wallets.mjs";
import { cfgFor, key, ladderBytes, TUE_11_NY, worldAt } from "./helpers.mjs";

/** A connection that records every call; sends confirm on the first status poll. */
function mockConn() {
  const calls = { send: 0, blockhash: 0, raw: [] };
  return {
    calls,
    async getLatestBlockhash() { calls.blockhash++; return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1000 }; },
    async sendRawTransaction(raw) { calls.send++; calls.raw.push(raw); return `sig${calls.send}`; },
    async getBlockHeight() { return 10; },
    async getSignatureStatuses(sigs) { return { value: sigs.map(() => ({ confirmationStatus: "confirmed", err: null })) }; },
  };
}

function fleet(n) { return Array.from({ length: n }, (_, index) => ({ index, keypair: Keypair.generate(), ephemeral: true })); }

function deps({ plan, conn, world, clock, coins = 5_000_000_000n }) {
  const w = world;
  return {
    cfg: cfgFor(), weights: { caller: 1, longshot: 0, trader: 0, house: 0, starter: 0, collector: 0 },
    wallets: fleet(6), treasury: Keypair.generate(), faucet: Keypair.generate(), plan,
    reader: {
      world: async () => w,
      livePrice: async () => ({ price: 6_500_000_000_000n, expo: -8, publishTime: Math.floor(clock() / 1000), source: "chain" }),
      usdRates: async () => ({ STOOK: 0.01 }),
      ladder: async () => w.coins[0].today.round.l,
    },
    sender: createSender({ conn, plan, window: new TxWindow(100), sleep: async () => {}, pollMs: 0 }),
    conn,
    rng: rngFrom("sim"),
    now: clock, sleep: async () => {}, out: () => {},
    readWallets: async (owners) => owners.map(() => ({ lamports: 50_000_000n, coins: { STOOK: coins } })),
    readLamports: async (owners) => owners.map(() => 0n),
  };
}

test("while a round trades, arbitrageurs take SIM_ARB_TURN_WEIGHT times their share of the turns", async () => {
  const clock = () => TUE_11_NY;
  const share = async (world) => {
    const d = deps({ plan: true, conn: mockConn(), world, clock });
    d.wallets = fleet(200);
    d.weights = { caller: 1, arb: 1 };
    d.cfg = cfgFor({ arbTurnWeight: 4 });
    d.rng = rngFrom("turns");
    const sim = createSim(d);
    await sim.refreshWorld(true);
    let arb = 0;
    for (let k = 0; k < 4000; k++) if (sim.pickWallet().persona === "arb") arb++;
    const act = (p) => sim.profiles.filter((x) => x.persona === p).reduce((a, x) => a + x.activity, 0);
    return { got: arb / 4000, even: act("arb") / (act("arb") + act("caller")), boosted: (4 * act("arb")) / (4 * act("arb") + act("caller")) };
  };
  const trading = await share(worldAt(TUE_11_NY));
  assert.ok(Math.abs(trading.got - trading.boosted) < 0.03, JSON.stringify(trading));
  const closed = worldAt(TUE_11_NY);
  closed.coins[0].today.round.l = { ...closed.coins[0].today.round.l, status: "settled" };
  const quiet = await share(closed);
  assert.ok(Math.abs(quiet.got - quiet.even) < 0.03, JSON.stringify(quiet));
});

test("--plan goes alone", () => {
  assert.throws(() => parseArgs(["--plan", "--watch"]), /cannot go with --watch/);
  assert.throws(() => parseArgs(["--plan", "--once", "2"]), /cannot go with --once/);
  assert.throws(() => parseArgs([]), /usage/);
  assert.equal(parseArgs(["--once", "3"]).once, 3);
  assert.equal(parseArgs(["--plan", "5"]).n, 5);
});

test("the send guard refuses in plan mode before touching the chain", async () => {
  const conn = mockConn();
  const s = createSender({ conn, plan: true, window: new TxWindow(4) });
  await assert.rejects(() => s.send([], 1000, [Keypair.generate()], "buy"), PlanRefusal);
  assert.equal(conn.calls.send + conn.calls.blockhash, 0);
});

test("plan mode builds turns and the funding it would do, and sends nothing", async () => {
  const conn = mockConn();
  const clock = () => TUE_11_NY;
  const d = deps({ plan: true, conn, world: worldAt(TUE_11_NY), clock });
  const lines = [];
  d.out = (s) => lines.push(s);
  const sim = createSim(d);
  const planned = await sim.planRun(30);
  assert.equal(conn.calls.send, 0);
  assert.equal(conn.calls.blockhash, 0);
  assert.equal(planned.length, 30);
  // Some turns built real transactions (buys, the faucet), none went out.
  assert.ok(planned.some((p) => p.txs?.length), JSON.stringify(planned.slice(0, 3)));
  const fund = lines.map((l) => JSON.parse(l)).find((x) => x.plan === "fund");
  // The arbitrageurs' view of the round trading now: its spikiness and the fair odds beside it.
  const arb = lines.map((l) => JSON.parse(l)).find((x) => x.plan === "arb");
  assert.equal(arb.coin, "STOOK");
  assert.ok(arb.crowd.maxProb > 0 && arb.fair.maxProb > 0 && Array.isArray(arb.cheapest));
  assert.equal(fund.wallets, 6);
  assert.ok(fund.sol > 0 && fund.sol <= 9);
  // Nothing on disk moved: the persisted state is untouched.
  assert.equal(sim.state.sol.spent ?? "0", "0");
});

test("a real turn goes out with the heap frame first and is journaled", async () => {
  const conn = mockConn();
  const clock = () => TUE_11_NY;
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock });
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  d.cfg = cfgFor({ maxDepthFrac: 0.5 });
  d.faucet = null;
  const sim = createSim(d);
  let sent = 0;
  for (let k = 0; k < 20 && !sent; k++) { const e = await sim.act(); if (e?.sig) sent++; }
  assert.equal(sent, 1, JSON.stringify(logged.slice(-3)));
  const tx = Transaction.from(conn.calls.raw[0]);
  assert.ok(tx.instructions[0].programId.equals(ComputeBudgetProgram.programId));
  assert.equal(tx.instructions[0].data[0], 1); // RequestHeapFrame
  assert.equal(tx.instructions[0].data.readUInt32LE(1), 256 * 1024);
  const buy = logged.find((e) => e.sig);
  assert.equal(buy.action, "buy");
  const j = Object.values(sim.journal.wallets).find((w) => w.positions.length);
  assert.equal(j.positions[0].ladder, buy.round);
});

test("the pause is honoured by --once", async () => {
  const conn = mockConn();
  const bell = Date.UTC(2026, 8, 29, 19, 55); // 15:55 New York
  const d = deps({ plan: false, conn, world: worldAt(bell), clock: () => bell });
  const sim = createSim(d);
  assert.deepEqual(await sim.once(3), []);
  assert.equal(conn.calls.send, 0);
});

test("the day's report is due once, at 21:00 New York", () => {
  const conn = mockConn();
  let t = Date.UTC(2026, 8, 30, 0, 30); // 20:30 New York
  const d = deps({ plan: false, conn, world: worldAt(t), clock: () => t });
  const sent = [];
  d.alert = (args) => sent.push(args);
  const sim = createSim(d);
  assert.equal(sim.reportDue(t), false);
  t = Date.UTC(2026, 8, 30, 1, 1);
  assert.equal(sim.reportDue(t), true);
  const msg = sim.report(t);
  assert.match(msg, /Stook sim/);
  assert.equal(sent[0][0], "--report");
  assert.equal(sim.reportDue(t), false);
});

test("logs rotate by size and the issue book counts each class once", () => {
  const dir = mkdtempSync(join(tmpdir(), "sim-"));
  const log = new JsonlLog(join(dir, "a.jsonl"), { maxBytes: 2_000, keep: 2 });
  for (let i = 0; i < 200; i++) log.append({ i, pad: "x".repeat(40) });
  assert.ok(statSync(join(dir, "a.jsonl")).size <= 2_000);
  assert.ok(existsSync(join(dir, "a.jsonl.1")) && existsSync(join(dir, "a.jsonl.2")) && !existsSync(join(dir, "a.jsonl.3")));
  const book = new IssueBook(join(dir, "issues.jsonl"));
  const c = classify(new Error("weird thing"), "buy");
  assert.equal(book.record(c, { m: 1 }), true);
  assert.equal(book.record(c, { m: 2 }), false);
  const again = new IssueBook(join(dir, "issues.jsonl"));
  assert.equal(again.top(1)[0].count, 2);
  assert.equal(readFileSync(join(dir, "issues.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("wallets are written 0600 once and reused; a plan writes none", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "sim-")), "wallets");
  const a = loadFleet(dir, 3, { create: true });
  assert.equal(a.made, 3);
  assert.equal(statSync(join(dir, "0.json")).mode & 0o777, 0o600);
  const b = loadFleet(dir, 3, { create: true });
  assert.equal(b.made, 0);
  assert.ok(a.wallets[2].keypair.publicKey.equals(b.wallets[2].keypair.publicKey));
  const planDir = join(mkdtempSync(join(tmpdir(), "sim-")), "wallets");
  const p = loadFleet(planDir, 2, { create: false });
  assert.ok(p.wallets.every((w) => w.ephemeral));
  assert.equal(existsSync(planDir), false);
});

// ── the guards added after review ───────────────────────────────────────────

const slippage = () => Object.assign(new Error("Simulation failed"), { logs: ["Program log: AnchorError occurred. Error Code: SlippageExceeded. Error Number: 6001. Error Message: x."] });

test("a send whose wait on the minute cap runs into the bell is not sent, and its top-up is given back", async () => {
  let clock = Date.UTC(2026, 8, 29, 19, 49, 50); // 15:49:50 New York
  const conn = mockConn();
  const window = new TxWindow(1);
  window.record(clock - 1_000); // the minute's one send already went
  const d = deps({ plan: false, conn, world: worldAt(clock), clock: () => clock });
  d.sender = createSender({ conn, plan: false, window, now: () => clock, sleep: async (ms) => { clock += ms; }, pollMs: 0 });
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 0);
  assert.equal(sim.budget.spent(clock), 0n);
  assert.match(logged[0].skip, /bell/);
});

test("a top-up is booked before it is sent, so a crash mid-send leaves it counted", async () => {
  const clock = () => TUE_11_NY;
  const d = deps({ plan: false, conn: mockConn(), world: worldAt(TUE_11_NY), clock });
  d.sender = { send: () => new Promise(() => {}), counts: {} };
  const sim = createSim(d);
  sim.fundingSweep();
  await new Promise((r) => setImmediate(r));
  assert.ok(sim.budget.spent(TUE_11_NY) > 0n);
});

test("a top-up that landed and failed keeps only its fee booked", async () => {
  const conn = mockConn();
  conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => ({ err: { InstructionError: [2, { Custom: 1 }] } })) });
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.issues = { record: () => false };
  const sim = createSim(d);
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 1);
  assert.equal(sim.budget.spent(TUE_11_NY), 10_000n);
});

test("a buy is never signed twice after expiring; a collect is, only once the first copy is surely absent", async () => {
  const conn = mockConn();
  let height = 10;
  conn.getBlockHeight = async () => (height += 2_000);
  conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => null) });
  const s = createSender({ conn, plan: false, window: new TxWindow(100), sleep: async () => {}, pollMs: 0 });
  await assert.rejects(() => s.send([], 1000, [Keypair.generate()], "buy", { resign: false }), /expired/);
  assert.equal(conn.calls.send, 1);
  // The first copy turns up on the last look: it is returned, not sent again.
  const c2 = mockConn();
  let looks = 0;
  c2.getBlockHeight = async () => 5_000;
  c2.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => (++looks > 2 ? { confirmationStatus: "confirmed", err: null } : null)) });
  const s2 = createSender({ conn: c2, plan: false, window: new TxWindow(100), sleep: async () => {}, pollMs: 0 });
  assert.equal(await s2.send([], 1000, [Keypair.generate()], "collect"), "sig1");
  assert.equal(c2.calls.send, 1);
});

test("a slippage on a curve that has not moved since the quote is a quote bug, not the market", async () => {
  for (const moved of [false, true]) {
    const conn = mockConn();
    conn.sendRawTransaction = async () => { throw slippage(); };
    const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
    d.cfg = cfgFor({ maxDepthFrac: 0.5 });
    d.faucet = null;
    const l = d.reader.ladder;
    let reads = 0;
    d.reader.ladder = async (k) => { const x = await l(k); return ++reads % 2 === 0 && moved ? { ...x, curveSeq: x.curveSeq + 1n } : x; };
    const issues = [];
    d.issues = { record: (c) => { issues.push(c); return true; } };
    const logged = [];
    d.log = { append: (e) => logged.push(e) };
    const sim = createSim(d);
    for (let k = 0; k < 20 && !logged.some((e) => e.error); k++) await sim.act();
    const failure = logged.find((e) => e.error);
    assert.ok(failure, JSON.stringify(logged.slice(-2)));
    assert.equal(failure.error, moved ? "SlippageExceeded" : "QuoteMismatch");
    assert.equal(failure.kind, moved ? "expected" : "unexpected");
    assert.equal(issues.length, moved ? 0 : 1);
  }
});

test("coins short after the balance check passed is a bug in the limit, filed unexpected", async () => {
  const conn = mockConn();
  conn.sendRawTransaction = async () => { throw Object.assign(new Error("Simulation failed"), { logs: ["Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1"] }); };
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.cfg = cfgFor({ maxDepthFrac: 0.5 });
  d.faucet = null;
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  for (let k = 0; k < 20 && !logged.some((e) => e.error); k++) await sim.act();
  assert.equal(logged.find((e) => e.error).error, "InsufficientFundsDespiteCheck");
});

test("a sale that finds one line gone forgets that line, not the wallet's round", async () => {
  const w = worldAt(TUE_11_NY);
  const conn = mockConn();
  conn.getMultipleAccountsInfo = async (keys) => keys.map((_k, n) => (n === 0 ? { data: new Uint8Array(0) } : null));
  const d = deps({ plan: false, conn, world: w, clock: () => TUE_11_NY });
  d.weights = { caller: 0, longshot: 0, trader: 1, house: 0, starter: 0, collector: 0 };
  d.faucet = null;
  const ladder = w.coins[0].today.key.toBase58();
  const line = (lo) => ({ ladder, coin: "STOOK", lo, hi: lo, h: 1, settlesAt: 0, boughtAt: 0 });
  d.journal = { wallets: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [String(i), { positions: [line(10)], tranches: [{ ladder, coin: "STOOK", index: 0, settlesAt: 0 }], faucetDay: null }])) };
  const sim = createSim(d);
  const e = await sim.act();
  assert.equal(e.action, "sell");
  assert.match(e.skip, /no longer held/);
  const j = sim.journal.wallets[String(e.wallet)];
  assert.equal(j.positions.length, 0);
  assert.equal(j.tranches.length, 1);
});

test("--once stops between turns when a pause begins", async () => {
  let clock = Date.UTC(2026, 8, 29, 19, 49, 0); // 15:49 New York
  const d = deps({ plan: false, conn: mockConn(), world: worldAt(clock), clock: () => clock });
  d.faucet = null;
  // Each turn takes a minute of the clock, so the second would start at 15:50.
  const read = d.readWallets;
  d.readWallets = async (...a) => { clock += 60_000; return read(...a); };
  const sim = createSim(d);
  assert.equal((await sim.once(5)).length, 1);
});

test("a start refused because the round exists re-reads the world on the next turn", async () => {
  const conn = mockConn();
  conn.sendRawTransaction = async () => { throw new Error("Allocate: account Address { address: X } already in use"); };
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.weights = { caller: 0, longshot: 0, trader: 0, house: 0, starter: 1, collector: 0 };
  d.faucet = null;
  let reads = 0;
  const world = d.reader.world;
  d.reader.world = async () => { reads++; return world(); };
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  for (let k = 0; k < 30 && !logged.some((e) => e.action === "start" && e.error); k++) await sim.act();
  assert.equal(logged.find((e) => e.action === "start" && e.error)?.error, "AlreadyInUse");
  const before = reads;
  await sim.act();
  assert.equal(reads, before + 1);
});

test("a buy whose connection dropped after it went out is journaled, for collect to reconcile", async () => {
  const conn = mockConn();
  conn.sendRawTransaction = async () => { throw new Error("fetch failed"); };
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.cfg = cfgFor({ maxDepthFrac: 0.5 });
  d.faucet = null;
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  for (let k = 0; k < 20 && !logged.some((e) => e.error); k++) await sim.act();
  const failure = logged.find((e) => e.error);
  assert.equal(failure.kind, "transient");
  assert.ok(Object.values(sim.journal.wallets).some((w) => w.positions.some((p) => p.ladder === failure.round)));
});

test("nothing is rebroadcast while the gate says pause", async () => {
  const conn = mockConn();
  let polls = 0;
  conn.getSignatureStatuses = async (sigs) => ({ value: sigs.map(() => (++polls > 4 ? { confirmationStatus: "confirmed", err: null } : null)) });
  const s = createSender({ conn, plan: false, window: new TxWindow(100), sleep: async () => {}, pollMs: 0 });
  let first = true;
  s.gate = () => (first ? ((first = false), null) : "bell");
  await s.send([], 1000, [Keypair.generate()], "buy");
  assert.equal(conn.calls.send, 1);
});

// ── SOL coming back: reclaims, retiring wallets, the runway ─────────────────

const SOL = 1_000_000_000n;
/** readLamports from a map of wallet index to balance (0 for the rest). */
const balancesOf = (wallets, by) => async (owners) => owners.map((o) => by[wallets.find((w) => w.keypair.publicKey.equals(o)).index] ?? 0n);
const transfersIn = (raw) => Transaction.from(raw).instructions.filter((ix) => ix.programId.equals(SystemProgram.programId));

test("the sweep sends back what active wallets hold over the line, six to a transaction, the treasury paying the fee", async () => {
  const conn = mockConn();
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.wallets = fleet(10);
  // Eight over 0.06 SOL, one at it, one between the min and the target.
  const by = { 0: 100_000_000n, 1: 70_000_000n, 2: 60_000_000n, 3: 20_000_000n };
  for (let i = 4; i < 10; i++) by[i] = 80_000_000n + BigInt(i);
  d.readLamports = balancesOf(d.wallets, by);
  d.state = { sol: { day: "2026-09-29", spent: String(SOL) } };
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 2);
  const [a, b] = conn.calls.raw.map((r) => Transaction.from(r));
  for (const tx of [a, b]) {
    assert.ok(tx.feePayer.equals(d.treasury.publicKey));
    assert.ok(tx.serialize().length <= 1232);
  }
  assert.equal(transfersIn(conn.calls.raw[0]).length, 6);
  assert.equal(transfersIn(conn.calls.raw[1]).length, 2);
  assert.equal(a.signatures.length, 7);
  const back = logged.filter((e) => e.action === "reclaim");
  assert.equal(back.length, 8);
  assert.ok(back.every((e) => e.sig && e.params.lamports));
  assert.equal(back.find((e) => e.wallet === 0).params.lamports, String(50_000_000n)); // down to the target (0.05 here)
  assert.ok(!back.some((e) => e.wallet === 2 || e.wallet === 3));
  const total = back.reduce((s, e) => s + BigInt(e.params.lamports), 0n);
  // The day's net went down by what came back, up by the two fees.
  const fees = BigInt(sim.budget.spent(TUE_11_NY)) - (SOL - total);
  assert.ok(fees > 0n && fees < 100_000n, String(fees));
  assert.equal(sim.state.stats.actions.reclaim.ok, 8);
  assert.equal(sim.state.stats.returnedLamports, total.toString());
});

test("reclaims go through the send gate: none in a pause", async () => {
  const clock = Date.UTC(2026, 8, 29, 19, 55); // 15:55 New York, the bell
  const conn = mockConn();
  const d = deps({ plan: false, conn, world: worldAt(clock), clock: () => clock });
  d.sender = createSender({ conn, plan: false, window: new TxWindow(100), now: () => clock, sleep: async () => {}, pollMs: 0 });
  d.readLamports = balancesOf(d.wallets, { 0: 90_000_000n, 1: 90_000_000n, 2: 90_000_000n, 3: 90_000_000n, 4: 90_000_000n, 5: 90_000_000n });
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  await sim.refreshWorld(true);
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 0, JSON.stringify(logged));
  assert.equal(logged[0].action, "reclaim");
  assert.match(logged[0].skip, /bell/);
  assert.equal(sim.budget.spent(clock), 0n);
});

test("a plan shows the reclaims and the retiring wallets and sends nothing", async () => {
  const conn = mockConn();
  const d = deps({ plan: true, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.wallets = [...fleet(4), { index: 4, keypair: Keypair.generate(), retiring: true }, { index: 5, keypair: Keypair.generate(), retiring: true }];
  d.readLamports = balancesOf(d.wallets, { 0: 90_000_000n, 1: 30_000_000n, 2: 30_000_000n, 3: 30_000_000n, 4: 20_000_000n, 5: 10_000_000n });
  d.journal = { wallets: { 5: { positions: [{ ladder: key().toBase58(), coin: "STOOK", lo: 1, hi: 1, h: 1, settlesAt: 0, boughtAt: 0 }], tranches: [] } } };
  const lines = [];
  d.out = (s) => lines.push(s);
  const sim = createSim(d);
  await sim.refreshWorld(true);
  await sim.fundingSweep();
  const got = Object.fromEntries(lines.map((l) => JSON.parse(l)).map((x) => [x.plan, x]));
  assert.equal(got.reclaim.wallets, 1);
  assert.equal(got.reclaim.sol, 0.04);
  assert.deepEqual([got.retire.retiring, got.retire.holding, got.retire.dueNow, got.retire.returns, got.retire.sol], [2, 1, 1, 1, 0.02]);
  assert.equal(got.fund.wallets, 0);
  assert.equal(conn.calls.send, 0);
});

test("retiring wallets: never topped up or picked, only collect (the treasury paying), then send every lamport back and stay retired", async () => {
  const conn = mockConn();
  const w = worldAt(TUE_11_NY);
  const d = deps({ plan: false, conn, world: w, clock: () => TUE_11_NY });
  d.cfg = cfgFor({ maxDepthFrac: 0.5 });
  // 0..3 active; 4 holds a line in a finished round, 5 holds nothing, 6 holds nothing and no SOL,
  // 7 holds a line in today's round, still trading.
  d.wallets = [...fleet(4), ...[4, 5, 6, 7].map((index) => ({ index, keypair: Keypair.generate(), ephemeral: false, retiring: true }))];
  const done = key().toBase58();
  const line = (ladder, settlesAt) => ({ ladder, coin: "STOOK", lo: 10, hi: 10, h: 1, settlesAt, boughtAt: 0 });
  const settles = Number(w.coins[0].today.round.l.settlesAt);
  d.journal = { wallets: { 4: { positions: [line(done, 0)], tranches: [], faucetDay: null }, 7: { positions: [line(w.coins[0].today.key.toBase58(), settles)], tranches: [], faucetDay: null } } };
  const by = { 0: 30_000_000n, 1: 30_000_000n, 2: 30_000_000n, 3: 30_000_000n, 4: 1_000n, 5: 30_000_000n, 6: 0n, 7: 2_000n };
  d.readLamports = balancesOf(d.wallets, by);
  d.readWallets = async (owners) => owners.map((o) => ({ lamports: by[d.wallets.find((x) => x.keypair.publicKey.equals(o)).index] ?? 0n, coins: { STOOK: 5_000_000_000n } }));
  // The finished round and wallet 4's line on it, for collect's read.
  conn.getMultipleAccountsInfo = async (keys) => keys.map((_k, n) => (n === 0 ? { data: ladderBytes({ status: "settled" }) } : { data: new Uint8Array(8) }));
  d.getBalance = async () => 50n * SOL;
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  assert.deepEqual(sim.profiles.map((p) => p.index), [0, 1, 2, 3]);

  await sim.fundingSweep();
  // Under the min (4, 6, 7 sit near zero), yet no top-up reached a retiring wallet.
  assert.ok(!logged.some((e) => e.action === "fund"));
  const collect = logged.find((e) => e.action === "collect");
  assert.equal(collect?.wallet, 4, JSON.stringify(logged));
  assert.ok(collect.sig);
  const collectTx = Transaction.from(conn.calls.raw[0]);
  assert.ok(collectTx.feePayer.equals(d.treasury.publicKey));
  assert.equal(sim.journal.wallets["4"].positions.length, 0);
  // 5 sends everything back, the treasury paying the fee; 6 had none to send.
  const retire = logged.filter((e) => e.action === "retire");
  assert.deepEqual(retire.map((e) => e.wallet), [5]);
  assert.equal(retire[0].params.lamports, String(30_000_000n));
  const back = Transaction.from(conn.calls.raw[1]);
  assert.ok(back.feePayer.equals(d.treasury.publicKey));
  assert.equal(transfersIn(conn.calls.raw[1])[0].keys[0].pubkey.toBase58(), d.wallets[5].keypair.publicKey.toBase58());
  assert.deepEqual(sim.state.retired, [5, 6]);
  assert.equal(conn.calls.send, 2, JSON.stringify(logged));

  // Next sweep: 4 holds nothing now and returns its SOL (the collect's rent included); 7's round still trades.
  by[4] = 2_500_000n; by[5] = 0n;
  await sim.fundingSweep();
  assert.deepEqual(logged.filter((e) => e.action === "retire").map((e) => e.wallet), [5, 4]);
  assert.deepEqual(sim.state.retired, [4, 5, 6]);
  assert.equal(sim.state.fleet.retiring, 1, JSON.stringify(logged.filter((e) => e.wallet >= 4)));
  assert.equal(sim.state.fleet.retired, 3);
  const sends = conn.calls.send;

  // Retired wallets are left alone; a retiring one with an open line never trades.
  by[4] = 0n;
  await sim.fundingSweep();
  assert.equal(conn.calls.send, sends);
  assert.equal(await sim.act(sim.retiringProfiles.get(7)), null);
  assert.equal(conn.calls.send, sends);
  for (let k = 0; k < 15; k++) { const e = await sim.act(); if (e) assert.ok(e.wallet < 4, JSON.stringify(e)); }
  assert.ok(!logged.some((e) => typeof e.wallet === "number" && e.wallet >= 4 && !["collect", "retire"].includes(e.action)), JSON.stringify(logged.filter((e) => e.wallet >= 4)));
});

test("a retired wallet that SOL reaches again (a round's rent, late) is swept once it is worth it", async () => {
  const conn = mockConn();
  const d = deps({ plan: false, conn, world: worldAt(TUE_11_NY), clock: () => TUE_11_NY });
  d.wallets = [...fleet(2), { index: 2, keypair: Keypair.generate(), retiring: true }];
  const by = { 0: 30_000_000n, 1: 30_000_000n, 2: 500_000n };
  d.readLamports = balancesOf(d.wallets, by);
  d.state = { retired: [2, 1] }; // 1 is active again: it leaves the list
  const logged = [];
  d.log = { append: (e) => logged.push(e) };
  const sim = createSim(d);
  assert.deepEqual(sim.state.retired, [2]);
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 0);
  by[2] = 26_000_000n;
  await sim.fundingSweep();
  assert.equal(conn.calls.send, 1);
  assert.equal(logged.find((e) => e.action === "retire").params.lamports, "26000000");
});

test("the treasury check keeps the balance and runway in state and alerts when either runs low", async () => {
  const conn = mockConn();
  const clock = TUE_11_NY;
  const d = deps({ plan: false, conn, world: worldAt(clock), clock: () => clock });
  d.readLamports = balancesOf(d.wallets, { 0: 30_000_000n, 1: 30_000_000n, 2: 30_000_000n, 3: 30_000_000n, 4: 30_000_000n, 5: 30_000_000n });
  const history = Array.from({ length: 7 }, (_, n) => ({ day: new Date(clock - (7 - n) * 86_400_000).toISOString().slice(0, 10), net: String(2n * SOL) }));
  d.state = { sol: { day: "2026-09-29", spent: "0", history } };
  let balance = 20n * SOL;
  d.getBalance = async () => balance;
  const alerts = [];
  d.alert = (a) => alerts.push(a);
  const sim = createSim(d);
  await sim.fundingSweep();
  assert.equal(sim.state.treasury.lamports, String(20n * SOL));
  assert.equal(sim.state.treasury.runwayDays, 10);
  assert.equal(alerts.length, 0);
  balance = 8n * SOL; // 4 days at 2 SOL a day
  await sim.fundingSweep();
  assert.equal(alerts[0][0], "sim-treasury");
  assert.match(alerts[0][1], /8\.00 SOL, about 4\.0 days at 2\.00 SOL a day/);
  d.state.sol.history = []; // no spend on record: only the balance can alert
  balance = 2n * SOL;
  await sim.fundingSweep();
  assert.equal(alerts.length, 2);
  assert.match(alerts[1][1], /2\.00 SOL/);
  const msg = sim.report(Date.UTC(2026, 8, 30, 1, 1));
  assert.match(msg, /Treasury: 2\.00 SOL/);
  assert.match(msg, /6 active, 0 retiring, 0 retired/);
  assert.doesNotMatch(msg, /\u2014/);
});

test("the wallet files past SIM_WALLETS load as retiring, in index order", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "sim-")), "wallets");
  loadFleet(dir, 5, { create: true });
  mkdirSync(join(dir, "extra"), { recursive: true });
  writeFileSync(join(dir, "notes.txt"), "x");
  const { wallets, made } = loadFleet(dir, 3, { create: true });
  assert.equal(made, 0);
  assert.deepEqual(wallets.map((w) => [w.index, !!w.retiring]), [[0, false], [1, false], [2, false], [3, true], [4, true]]);
});

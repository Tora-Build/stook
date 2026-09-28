// Deciding a turn: the faucet's amounts as the app rounds them, when a
// round is due for collection, and the faucet at most once a day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { coinsForWorth, decide, dueRounds, fleetLines, forget, forgetLine, fromUsd, linesClosingAt, START_LAMPORTS, walletJournal } from "../src/actions.mjs";
import { profileOf, rngFrom } from "../src/personas.mjs";
import { cfgFor, ladderBytes, TUE_11_NY, worldAt } from "./helpers.mjs";

test("faucet amounts round as the app's coinsForWorth", () => {
  assert.equal(coinsForWorth(undefined), 10_000);
  assert.equal(coinsForWorth(0.01), 100_000);
  assert.equal(coinsForWorth(3.3), 300);
  assert.equal(coinsForWorth(0.0000371), 27_000_000);
  assert.equal(coinsForWorth(65_000), 1);
  assert.equal(fromUsd(5, 6, 0.01), 500_000_000n);
  assert.equal(fromUsd(5, 6, 0), 0n);
});

test("a round is due once finished and past the wallet's delay; void at once", () => {
  const w = worldAt(TUE_11_NY);
  const c = w.coins[0];
  const j = { positions: [{ ladder: "old", coin: "STOOK", lo: 1, hi: 1, h: 1, settlesAt: 1000 }, { ladder: c.today.key.toBase58(), coin: "STOOK", lo: 1, hi: 1, h: 1, settlesAt: 99_999_999_999 }], tranches: [] };
  const p = { collectDelay: 600 };
  assert.deepEqual(dueRounds(j, p, 1500, w), []);
  assert.deepEqual(dueRounds(j, p, 1600, w).map((x) => x.ladder), ["old"]);
  c.today.round.l = { ...c.today.round.l, status: "void" };
  assert.equal(dueRounds(j, p, 1600, w).length, 2);
  assert.equal(fleetLines({ wallets: { 0: j, 1: { positions: [{ ladder: "old" }], tranches: [] } } }).get("old"), 2);
});

test("an empty wallet takes test coins first, once a UTC day", () => {
  const w = worldAt(TUE_11_NY);
  const journal = {};
  const j = walletJournal(journal, 0);
  const ctx = (coins) => ({ world: w, profile: profileOf(0, { caller: 1 }, "t"), bal: { lamports: 50_000_000n, coins: { STOOK: coins } }, j, rng: rngFrom("f"), t: TUE_11_NY / 1000, cfg: cfgFor(), rates: { STOOK: 0.01 }, faucet: Keypair.generate(), wallet: Keypair.generate(), starters: [], lines: new Map(), detail: {} });
  const a = decide(ctx(0n));
  assert.equal(a.type, "faucet");
  assert.equal(a.params.coins.STOOK, (100_000n * 1_000_000n).toString());
  a.done();
  assert.notEqual(decide(ctx(0n)).type, "faucet");
  j.faucetDay = null;
  assert.notEqual(decide(ctx(90_000n * 1_000_000n)).type, "faucet");
});

test("with no starter in the fleet, a house funds tomorrow's round, and the start asks for its rent", () => {
  const w = worldAt(TUE_11_NY);
  const house = profileOf(3, { house: 1 }, "t");
  const ctx = (starters) => ({ world: w, profile: house, bal: { lamports: 50_000_000n, coins: { STOOK: 10n ** 12n } }, j: walletJournal({ wallets: {} }, 3), rng: rngFrom("h"), t: TUE_11_NY / 1000, cfg: cfgFor(), rates: { STOOK: 0.01 }, faucet: null, wallet: Keypair.generate(), starters, lines: new Map(), detail: {} });
  const a = decide(ctx([3]));
  assert.equal(a.type, "start");
  assert.equal(a.round, w.coins[0].tomorrow.key.toBase58());
  assert.equal(a.lamports, START_LAMPORTS);
  // A house that is not a funder (the fleet has starters) only deposits.
  assert.notEqual(decide(ctx([7])).type, "start");
});

const ctxFor = (w, over = {}) => ({ world: w, profile: profileOf(0, { caller: 1 }, "t"), bal: { lamports: 50_000_000n, coins: { STOOK: 10n ** 13n } }, j: walletJournal({ wallets: {} }, 0), rng: rngFrom("c"), t: TUE_11_NY / 1000, cfg: cfgFor({ maxPositionsPerRound: 100, maxLinesPerClose: 40 }), rates: { STOOK: 0.01 }, faucet: null, wallet: Keypair.generate(), starters: [], lines: new Map(), detail: {}, ...over });

test("no new line once the fleet holds enough across every round closing together", async () => {
  const w = worldAt(TUE_11_NY);
  const c = w.coins[0];
  // A second coin's round closing at the same time holds most of them.
  const other = { ...c, symbol: "ZCAT", today: { ...c.today, key: Keypair.generate().publicKey } };
  w.coins.push(other);
  const lines = new Map([[c.today.key.toBase58(), 10], [other.today.key.toBase58(), 30]]);
  const ctx = ctxFor(w, { lines });
  assert.equal(linesClosingAt(ctx, c.today.round.l.settlesAt), 40);
  const a = decide(ctx);
  assert.equal(a.type, "buy");
  await assert.rejects(() => a.build({ ladder: async () => c.today.round.l }), /closing at this time/);
  lines.set(other.today.key.toBase58(), 29);
  await assert.doesNotReject(async () => { try { await a.build({ ladder: async () => c.today.round.l, livePrice: async () => ({ price: 6_500_000_000_000n, expo: -8, publishTime: 0 }) }); } catch (e) { if (/closing at this time/.test(e.message)) throw e; } });
});

test("collect looks past rounds the keeper has not settled, and leaves them for half an hour", async () => {
  const w = worldAt(TUE_11_NY);
  const t = TUE_11_NY / 1000;
  const rounds = ["A", "B", "C", "D"].map(() => Keypair.generate().publicKey.toBase58());
  const j = walletJournal({ wallets: {} }, 0);
  for (const ladder of rounds) j.positions.push({ ladder, coin: "STOOK", lo: 5, hi: 5, h: 1, settlesAt: t - 86_400, boughtAt: 0 });
  const profile = { ...profileOf(0, { caller: 1 }, "t"), collectDelay: 60 };
  assert.equal(dueRounds(j, profile, t, w).length, 4);
  const settled = rounds[3];
  const conn = { getMultipleAccountsInfo: async (keys) => keys.map((k, n) => (n === 0 ? { data: ladderBytes({ status: k.toBase58() === settled ? "settled" : "open" }) } : { data: new Uint8Array(0) })) };
  const ctx = ctxFor(w, { j, profile, rng: () => 0 });
  const a = decide(ctx);
  assert.equal(a.type, "collect");
  const txs = await a.build({ conn });
  assert.deepEqual([...new Set(txs.map((x) => x.ladder))], [settled]);
  assert.deepEqual(dueRounds(j, profile, t, w).map((x) => x.ladder), [settled]);
  assert.equal(dueRounds(j, profile, t + 1801, w).length, 4);
  forget(j, rounds[0]);
  assert.equal(j.later[rounds[0]], undefined);
});

test("forgetting one line keeps the wallet's other lines and deposits in that round", () => {
  const j = { positions: [{ ladder: "r", lo: 1, hi: 1, h: 1 }, { ladder: "r", lo: 2, hi: 3, h: 2 }], tranches: [{ ladder: "r", index: 0 }] };
  forgetLine(j, "r", { lo: 1, hi: 1, h: 1 });
  assert.deepEqual(j.positions, [{ ladder: "r", lo: 2, hi: 3, h: 2 }]);
  assert.equal(j.tranches.length, 1);
});

test("the faucet mints the test USDC first, as the app does, when its mint is set", async () => {
  const w = worldAt(TUE_11_NY);
  const usdc = Keypair.generate().publicKey.toBase58();
  const a = decide(ctxFor(w, { bal: { lamports: 50_000_000n, coins: { STOOK: 0n } }, faucet: Keypair.generate(), cfg: cfgFor({ quoteMint: usdc }) }));
  assert.equal(a.type, "faucet");
  const [tx] = await a.build();
  assert.equal(tx.ixs.length, 4);
  assert.ok(tx.ixs[1].keys[0].pubkey.equals(new PublicKey(usdc)));
  assert.ok(tx.ixs[1].programId.equals(TOKEN_PROGRAM_ID));
  const none = decide(ctxFor(w, { bal: { lamports: 50_000_000n, coins: { STOOK: 0n } }, faucet: Keypair.generate() }));
  assert.equal((await none.build())[0].ixs.length, 2);
});

test("a probe buy sizes past the depth cap", async () => {
  const w = worldAt(TUE_11_NY);
  const c = w.coins[0];
  const reader = { ladder: async () => c.today.round.l, livePrice: async () => ({ price: 6_500_000_000_000n, expo: -8, publishTime: 0 }) };
  const sizes = {};
  for (const probeShare of [0, 1]) {
    const ctx = ctxFor(w, { cfg: cfgFor({ probeShare, maxPositionsPerRound: 100, maxLinesPerClose: 100 }), rng: rngFrom("probe") });
    const a = decide(ctx);
    assert.equal(!!a.params.probe, probeShare === 1);
    await a.build(reader).catch(() => {});
    sizes[probeShare] = BigInt(ctx.detail.pays ?? 0);
  }
  const depthCap = (c.today.round.l.depositTotal * 300n) / 10_000n;
  assert.ok(sizes[0] <= depthCap);
  assert.ok(sizes[1] > depthCap, `${sizes[1]} vs ${depthCap}`);
});

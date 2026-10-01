// The arbitrageur: fair odds from the live price, the band it buys and how
// much (toward fair, never past), the held lines it sells, its caps, and the
// persona's place in the fleet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { buySize, cheapBands, crowdOdds, fairOdds, feeFrac, planArbBuy, planArbSell, spikiness } from "../src/arb.mjs";
import { ARB_LINES_PER_ROUND, decide, depthShare, Skip, walletJournal } from "../src/actions.mjs";
import { DEFAULT_WEIGHTS, parseWeights, pickWeighted, profileOf, rngFrom, unit } from "../src/personas.mjs";
import { gauss } from "../src/pricing.mjs";
import { cfgFor, openRound, series, TUE_11_NY, worldAt } from "./helpers.mjs";

const LIVE = { price: 6_500_000_000_000n, expo: -8, publishTime: 0, source: "chain" };
const T = TUE_11_NY / 1000;

/** A curve whose odds are `p` (normalised), in the program's units. */
function curveOf(p) {
  const s = p.reduce((a, x) => a + x, 0);
  const w = p.map((x) => { const v = BigInt(Math.round((x / s) * 64e18)); return v < stook.MIN_W ? stook.MIN_W : v; });
  return { w, sum: w.reduce((a, v) => a + v, 0n) };
}

function round(over = {}) {
  const s = series();
  const l = openRound({ s, settlesAt: BigInt(T + 5 * 3600) });
  return { s, l: { ...l, ...over } };
}

test("fair odds sum to 1, sit symmetric around the live price with no drift, and widen with time", () => {
  const { s, l } = round();
  const fair = fairOdds(l, LIVE, s.varWad, 5 * 3600);
  assert.equal(fair.length, stook.BINS);
  assert.ok(Math.abs(fair.reduce((a, x) => a + x, 0) - 1) < 1e-9);
  assert.ok(fair.every((x) => x >= 0));
  // The live price is p0, the low edge of band 32: band 32+k mirrors 31-k.
  for (let k = 0; k < 32; k++) assert.ok(Math.abs(fair[32 + k] - fair[31 - k]) < 1e-8, `k=${k}`);
  // The tails are open: the last band holds everything above its low edge.
  const far = fairOdds({ ...l }, { ...LIVE, price: LIVE.price * 10n }, s.varWad, 3600);
  assert.ok(far[stook.BINS - 1] > 0.99);
  const short = spikinessOf(fairOdds(l, LIVE, s.varWad, 2 * 3600));
  const long = spikinessOf(fairOdds(l, LIVE, s.varWad, 20 * 3600));
  assert.ok(long.max < short.max && long.wide > short.wide, JSON.stringify({ short, long }));
  // Never narrower than an hour's spread.
  assert.deepEqual(fairOdds(l, LIVE, s.varWad, 60), fairOdds(l, LIVE, s.varWad, 3600));
});
const spikinessOf = (p) => ({ max: Math.max(...p), wide: p.filter((x) => x >= 0.01).length });

test("the arb buys the band the crowd prices furthest under fair, and never past fair", () => {
  const { s, l: base } = round();
  const fair = fairOdds(base, LIVE, s.varWad, 5 * 3600);
  const rng = rngFrom("arb-curves");
  const feeBps = 200, transferFee = { bps: 300, maxFee: 10n ** 15n };
  let bought = 0;
  for (let k = 0; k < 25; k++) {
    const l = { ...base, curve: curveOf(fair.map((x) => x * Math.exp(1.2 * gauss(rng)))) };
    const crowd = crowdOdds(l.curve);
    const cheap = cheapBands(fair, crowd, { fee: feeFrac(feeBps, transferFee), margin: 0.03, minFair: 0.005 });
    const plan = planArbBuy(l, fair, { feeBps, transferFee, budget: 10n ** 15n, margin: 0.03, maxWidth: 1 });
    if (!cheap.length) { assert.equal(plan, null); continue; }
    assert.ok(plan, `curve ${k}`);
    assert.equal(plan.band, cheap[0].i, `curve ${k}`);
    assert.deepEqual(plan.shape, stook.band(cheap[0].i, cheap[0].i));
    const i = plan.band;
    // As the program would price it: the band ends at or under fair, and the buy is worth what it costs.
    const q = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, plan.shape, plan.shares);
    assert.equal(q.total, plan.q.total);
    assert.ok(crowdOdds(q.curve)[i] <= fair[i], `${crowdOdds(q.curve)[i]} > ${fair[i]}`);
    assert.ok(crowdOdds(q.curve)[i] > crowd[i]);
    assert.ok(plan.worth >= plan.pays);
    // And it is the most that holds: one more share breaks one of them.
    const q2 = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, plan.shape, plan.shares + 1n);
    const pays2 = stook.grossFor(q2.total, transferFee);
    const worth2 = stook.netOf(BigInt(Math.floor(fair[i] * Number(plan.shares + 1n))), transferFee);
    assert.ok(crowdOdds(q2.curve)[i] > fair[i] || worth2 < pays2);
    bought++;
  }
  assert.ok(bought >= 10, `only ${bought} curves had a cheap band`);
  // Bands the crowd prices at next to nothing rank together, the most fair odds first.
  const p = fair.slice(); p[34] *= 1e-6; p[30] *= 1e-4; p[33] *= 0.5;
  const ranked = cheapBands(fair, crowdOdds(curveOf(p)), { fee: 0.02, margin: 0.03, minFair: 0.005 });
  assert.deepEqual(ranked.slice(0, 3).map((x) => x.i), [30, 34, 33]);
});

test("a run of neighbours about as cheap is bought as one band range, each band kept at or under fair; a much cheaper band goes alone", () => {
  const { s, l: base } = round();
  const fair = fairOdds(base, LIVE, s.varWad, 5 * 3600);
  // The ZCAT shape: one band holds 70%, the bands below it next to nothing.
  const spiky = (cut) => {
    const p = fair.slice();
    p[33] = 0.7 / (1 - 0.7) * (1 - fair[33]);
    cut(p);
    return { ...base, curve: curveOf(p) };
  };
  const l = spiky((p) => { p[32] *= 0.1; p[31] *= 0.1; p[30] *= 0.1; });
  assert.ok(spikiness(l.curve).maxProb > 0.6);
  const plan = planArbBuy(l, fair, { feeBps: 200, budget: 10n ** 15n, margin: 0.03, maxWidth: 3 });
  assert.deepEqual(plan.shape, stook.band(30, 32));
  for (let i = 30; i <= 32; i++) assert.ok(plan.after[i] <= fair[i] && plan.after[i] > plan.crowd[i]);
  assert.ok(spikiness(plan.q.curve).maxProb < spikiness(l.curve).maxProb);
  // A band a hundred times cheaper than its neighbour is lifted on its own.
  const lone = spiky((p) => { p[32] *= 0.001; p[31] *= 0.1; });
  assert.deepEqual(planArbBuy(lone, fair, { feeBps: 200, budget: 10n ** 15n, margin: 0.03, maxWidth: 3 }).shape, stook.band(32, 32));
});

test("the buy holds to its budget", () => {
  const { s, l: base } = round();
  const fair = fairOdds(base, LIVE, s.varWad, 5 * 3600);
  const p = fair.slice(); p[30] *= 0.1;
  const l = { ...base, curve: curveOf(p) };
  const open = buySize(l, stook.band(30, 30), { fair, feeBps: 200, budget: 10n ** 15n });
  const budget = open.pays / 4n;
  const held = buySize(l, stook.band(30, 30), { fair, feeBps: 200, budget });
  assert.ok(held.shares > 0n && held.shares < open.shares);
  assert.ok(held.pays <= budget);
  assert.equal(buySize(l, stook.band(30, 30), { fair, feeBps: 200, budget: 0n }).shares, 0n);
});

test("a held band the crowd prices over fair is sold back toward fair, not past it; one at fair is kept", () => {
  const { s, l: base } = round();
  const fair = fairOdds(base, LIVE, s.varWad, 5 * 3600);
  const p = fair.slice(); p[33] = 0.5 / 0.5 * (1 - fair[33]);
  const l = { ...base, curve: curveOf(p) };
  const transferFee = { bps: 300, maxFee: 10n ** 15n };
  const held = [{ shape: stook.band(33, 33), shares: 10n ** 13n }, { shape: stook.band(20, 20), shares: 10n ** 13n }];
  const plan = planArbSell(l, fair, { feeBps: 200, transferFee, held, margin: 0.03 });
  assert.equal(plan.side, "sell");
  assert.deepEqual(plan.shape, stook.band(33, 33));
  assert.ok(plan.shares > 0n && plan.shares < 10n ** 13n);
  assert.ok(plan.after[33] >= fair[33] && plan.after[33] < crowdOdds(l.curve)[33]);
  assert.ok(plan.gets >= plan.worth);
  // A small holding is sold whole when that still leaves the band over fair.
  const small = planArbSell(l, fair, { feeBps: 200, transferFee, held: [{ shape: stook.band(33, 33), shares: 1_000_000n }], margin: 0.03 });
  assert.equal(small.shares, 1_000_000n);
  // At fair (the round as opened is near it), nothing to sell.
  const near = { ...base, curve: curveOf(fair) };
  assert.equal(planArbSell(near, fair, { feeBps: 200, transferFee, held, margin: 0.03 }), null);
});

// ── as a turn ───────────────────────────────────────────────────────────────

function arbWorld(mutate) {
  const w = worldAt(TUE_11_NY);
  const c = w.coins[0], l = c.today.round.l;
  const fair = fairOdds(l, LIVE, c.series.varWad, Number(l.settlesAt) - T);
  const p = fair.slice();
  mutate(p);
  c.today.round.l = { ...l, curve: curveOf(p) };
  return { w, c, fair };
}
const arbCtx = (w, over = {}) => ({
  world: w, profile: profileOf(0, { arb: 1 }, "t"), bal: { lamports: 50_000_000n, coins: { STOOK: 10n ** 13n } }, j: walletJournal({ wallets: {} }, 0),
  rng: rngFrom("arb"), t: T, cfg: cfgFor({ maxPositionsPerRound: 100, maxLinesPerClose: 100, arbDepthFrac: 0.03, arbMargin: 0.03 }), rates: { STOOK: 0.01 },
  faucet: null, wallet: Keypair.generate(), starters: [], lines: new Map(), detail: {}, ...over,
});
const readerFor = (c) => ({ ladder: async () => c.today.round.l, livePrice: async () => LIVE });

test("an arb's turn is a buy as the app builds it, held to SIM_ARB_DEPTH_FRAC of the round and journaled", async () => {
  const { w, c, fair } = arbWorld((p) => { p[30] *= 0.05; });
  const ctx = arbCtx(w);
  const a = decide(ctx);
  assert.equal(a.type, "arb");
  const [tx] = await a.build(readerFor(c));
  assert.equal(a.type, "buy");
  assert.equal(a.round, c.today.key.toBase58());
  const l = c.today.round.l;
  assert.ok(ctx.detail.shape.lo <= 30 && ctx.detail.shape.hi >= 30);
  assert.ok(BigInt(ctx.detail.pays) <= depthShare(l, 0.03));
  assert.equal(tx.cu, stook.tradeComputeUnits(ctx.detail.shape));
  assert.equal(tx.ixs.length, 2);
  // The limit is the app's: the quote's total, padded by maxGrossFor at the coin's transfer fee.
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(T + 10), l.settlesAt);
  const q = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, ctx.detail.shape, BigInt(ctx.detail.shares));
  assert.equal(ctx.detail.limit, stook.maxGrossFor(q.total, [c.transferFee]).toString());
  for (const o of ctx.detail.odds) assert.ok(o.after <= o.fair, JSON.stringify({ o, fair: fair[o.band] }));
  a.done([tx]);
  assert.equal(ctx.j.positions.length, 1);
  assert.equal(ctx.j.positions[0].lo, ctx.detail.shape.lo);
});

test("an arb's buy holds to the wallet's coins", async () => {
  const { w, c } = arbWorld((p) => { p[30] *= 0.05; });
  const ctx = arbCtx(w, { bal: { lamports: 50_000_000n, coins: { STOOK: 2_000_000n } } });
  const a = decide(ctx);
  await a.build(readerFor(c));
  assert.ok(BigInt(ctx.detail.limit) <= 2_000_000n);
});

test("an arb with its lines in a round only adds to them; the arbs' own line cap holds; with nothing cheap it skips", async () => {
  const { w, c } = arbWorld((p) => { p[30] *= 0.05; });
  const key = c.today.key.toBase58();
  const j = walletJournal({ wallets: {} }, 0);
  for (let i = 0; i < ARB_LINES_PER_ROUND; i++) j.positions.push({ ladder: key, coin: "STOOK", lo: 50 + i, hi: 50 + i, h: 1, settlesAt: 0, boughtAt: 0, soldOut: true });
  const a = decide(arbCtx(w, { j }));
  await assert.rejects(() => a.build(readerFor(c)), (e) => e instanceof Skip && /mispriced/.test(e.message));
  j.positions[0] = { ...j.positions[0], lo: 30, hi: 30 };
  const ctx = arbCtx(w, { j });
  const b = decide(ctx);
  await b.build(readerFor(c));
  assert.deepEqual(ctx.detail.shape, { lo: 30, hi: 30, h: 1 });
  // The arbs together hold SIM_ARB_LINES_PER_ROUND lines there: no new one, whatever the rest of the fleet holds.
  const full = arbCtx(w, { arbLines: new Map([[key, 8]]), lines: new Map([[key, 0]]) });
  await assert.rejects(() => decide(full).build(readerFor(c)), Skip);
  const room = arbCtx(w, { arbLines: new Map([[key, 7]]), lines: new Map([[key, 999]]) });
  await decide(room).build(readerFor(c));
  assert.ok(room.detail.shape.lo <= 30 && room.detail.shape.hi >= 30);
  // A round at fair: nothing to do.
  const fairW = arbWorld(() => {});
  const z = decide(arbCtx(fairW.w));
  await assert.rejects(() => z.build(readerFor(fairW.c)), Skip);
});

test("an arb holding a line the crowd prices over fair turns to selling it first", async () => {
  // Band 33 at half the round: rich. Band 30 cheap as well, but the sale comes first.
  const { w, c } = arbWorld((p) => { p[33] = 1 - p[33]; p[30] *= 0.05; });
  const key = c.today.key.toBase58();
  const j = walletJournal({ wallets: {} }, 0);
  j.positions.push({ ladder: key, coin: "STOOK", lo: 33, hi: 33, h: 1, settlesAt: 0, boughtAt: 0 }, { ladder: key, coin: "STOOK", lo: 20, hi: 20, h: 1, settlesAt: 0, boughtAt: 0 });
  const ctx = arbCtx(w, { j });
  const a = decide(ctx);
  let asked = null;
  const conn = { getMultipleAccountsInfo: async (keys) => { asked = keys; return [{ data: new Uint8Array(0) }, null]; } };
  // The line is gone on chain: the turn says so and drops it, as a trader's sale does.
  await assert.rejects(() => a.build({ ...readerFor(c), conn }), (e) => e instanceof Skip && /no longer held/.test(e.message));
  assert.equal(a.type, "sell");
  assert.deepEqual(ctx.dropPosition, { lo: 33, hi: 33, h: 1 });
  assert.ok(asked[1].equals(stook.deriveLadderPosition(c.today.key, ctx.wallet.publicKey, { lo: 33, hi: 33, h: 1 })));
});

// ── the persona ─────────────────────────────────────────────────────────────

test("arbs come only from the callers' slice: every other wallet keeps its persona", () => {
  const OLD = { caller: 45, longshot: 10, trader: 20, house: 10, starter: 5, collector: 10 };
  const old = (i, seed) => pickWeighted(OLD, unit(seed, "persona", i));
  let arbs = 0;
  const n = 3000;
  for (let i = 0; i < n; i++) {
    const now = profileOf(i, DEFAULT_WEIGHTS, "stook-sim").persona;
    const was = old(i, "stook-sim");
    if (now !== was) { assert.equal(was, "caller"); assert.equal(now, "arb"); }
    if (now === "arb") arbs++;
  }
  assert.ok(Math.abs(arbs / n - 0.07) < 0.015, `${arbs}`);
  // An override written before the arbs: the same, its callers' slice split 38:7.
  const w = parseWeights("caller:45,longshot:10,trader:20,house:10,starter:5,collector:10");
  for (let i = 0; i < 500; i++) assert.equal(profileOf(i, w, "s").persona, profileOf(i, DEFAULT_WEIGHTS, "s").persona);
  // "arb:0": exactly the fleet before the arbs.
  const none = parseWeights("arb:0");
  for (let i = 0; i < 500; i++) assert.equal(profileOf(i, none, "s").persona, old(i, "s"));
  // Weights the list sets for both are taken as given.
  assert.deepEqual([parseWeights("caller:30,arb:10").caller, parseWeights("caller:30,arb:10").arb], [30, 10]);
});

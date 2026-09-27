// The keeper's I/O loop against mocked chain, scanner, Hermes and senders:
// plan mode never writes, and the heartbeat follows whether steps succeed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook } from "@sooth/sdk-solana";
import { createKeeper, parseArgs, main, watch } from "../src/index.mjs";

const now = () => BigInt(Math.floor(Date.now() / 1000));
const key = () => Keypair.generate().publicKey;
const feedId = new Uint8Array(32).fill(7);
const DAY = 86_400n;

// Accounts come back already decoded: the mocks hand the keeper objects.
const sdk = { ...stook, decodeLadder: (d) => d, decodeSeries: (d) => d, decodeProtocolConfig: (d) => d, decodeLadderPosition: (d) => d, decodeLadderTranche: (d) => d };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A world of mocks; `calls` records every write and every Hermes request. */
function world({ ladders = {}, series = [], tranches = {}, accounts = new Map(), primaryFails = false, hermes, sendTx, postAndConsume } = {}) {
  const calls = { sendTx: 0, postAndConsume: 0, hermes: 0 };
  const scanner = {
    async getProgramAccounts(_program, { filters }) {
      for (const status of ["seeding", "open", "settled", "void"]) {
        if (same(filters, stook.ladderFilters(status))) return (ladders[status] ?? []).map((l) => ({ pubkey: l.pubkey, account: { data: l } }));
      }
      if (filters[0]?.dataSize === stook.SERIES_SIZE) return series.map((s) => ({ pubkey: s.pubkey, account: { data: s } }));
      for (const [ladder, list] of Object.entries(tranches)) {
        if (same(filters, stook.trancheFilters(new PublicKey(ladder)))) return list.map((t) => ({ pubkey: key(), account: { data: t } }));
      }
      return [];
    },
  };
  const connection = {
    async getAccountInfo(k) {
      if (primaryFails) throw new Error("primary RPC fetch failed");
      return accounts.get(k.toBase58()) ?? null;
    },
  };
  const keeper = (plan = false) => createKeeper({
    connection, scanner, payer: Keypair.generate(), plan, sdk,
    hermes: async (...a) => { calls.hermes++; return hermes ? hermes(...a) : { parsed: undefined, vaas: [] }; },
    sendTx: async (tx) => { calls.sendTx++; return sendTx ? sendTx(tx) : "sig"; },
    postAndConsume: async (...a) => { calls.postAndConsume++; return postAndConsume ? postAndConsume(...a) : "sig"; },
  });
  return { calls, keeper, accounts };
}

const ladder = (over) => ({
  pubkey: key(), status: "seeding", opensAt: now() + DAY, locksAt: now() + 2n * DAY, settlesAt: now() + 2n * DAY,
  series: key(), quoteMint: key(), creator: key(), feedId, stepBps: 100, p0Expo: -8,
  openPositions: 0, openTranches: 0, feesCreator: 0n, feesProtocol: 0n, ...over,
});
const toOpen = () => ladder({ opensAt: now() - 10n });
const toSettle = () => ladder({ status: "open", opensAt: now() - DAY, locksAt: now() - 100n, settlesAt: now() - 60n });
const toVoid = () => ladder({ opensAt: now() - 2n * 3_600n });
const silenced = async (fn) => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = error; }
};

test("--plan is refused beside any mode that sends", async () => {
  for (const extra of [["--learn"], ["--clear-up"], ["--watch"], ["--learn", "--clear-up"], ["--watch", "--learn"]]) {
    assert.throws(() => parseArgs(["--plan", ...extra]), /--plan sends nothing/);
  }
  assert.deepEqual(parseArgs(["--plan"]), { plan: true, watch: false, learn: false, clearUp: false });
  assert.deepEqual(parseArgs(["--learn", "--clear-up"]), { plan: false, watch: false, learn: true, clearUp: true });
  // The CLI stops with an argument error before it builds anything.
  const before = process.exitCode;
  await silenced(() => main(["--plan", "--learn", "--clear-up"]));
  assert.equal(process.exitCode, 2);
  process.exitCode = before;
});

test("plan mode makes zero writes on every path", async () => {
  const w = world({
    ladders: { seeding: [toOpen(), toVoid()], open: [toSettle()], void: [ladder({ status: "void", settlesAt: now() - DAY })] },
    series: [{ pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 25, varWad: 1n, lastAt: now() - 5n * DAY }],
    hermes: async () => { throw new Error("plan mode asked Hermes"); },
  });
  const k = w.keeper(true);
  assert.equal(await silenced(() => k.pass()), 0);
  await assert.rejects(k.learn(), /plan mode sends nothing/);
  await assert.rejects(k.clearUp(), /plan mode sends nothing/);
  assert.deepEqual(w.calls, { sendTx: 0, postAndConsume: 0, hermes: 0 });
});

test("a pass whose primary RPC fails is alive but unhealthy, through the backoff", async () => {
  const w = world({ ladders: { seeding: [toOpen()] }, primaryFails: true });
  const k = w.keeper();
  let beats = 0, healths = 0;
  await silenced(() => watch(k, { interval: 0, beat: () => beats++, healthy: () => healths++, passes: 3, sleep: async () => {} }));
  assert.equal(beats, 3, "the scan works, so the keeper is alive");
  assert.equal(healths, 0, "but the round keeps failing");
  // The round is cooling down after its failure; it still counts until it succeeds.
  assert.equal(await silenced(() => k.pass()), 1);
});

test("idle passes and expected waiting are healthy and beat", async () => {
  const warming = toOpen();
  const settle = toSettle();
  const accounts = new Map([
    [warming.series.toBase58(), { data: { feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 3, varWad: 1n, lastAt: now() - DAY } }],
    [settle.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }],
    [stook.deriveProtocolConfig().toBase58(), { data: { treasury: key() } }],
  ]);
  for (const ladders of [{}, { seeding: [ladder({})] }, { seeding: [warming] }, { open: [settle] }]) {
    const w = world({ ladders, accounts });
    let beats = 0, healths = 0;
    await silenced(() => watch(w.keeper(), { interval: 0, beat: () => beats++, healthy: () => healths++, passes: 2, sleep: async () => {} }));
    assert.equal(beats, 2, JSON.stringify(Object.keys(ladders)));
    assert.equal(healths, 2, JSON.stringify(Object.keys(ladders)));
    assert.equal(w.calls.sendTx + w.calls.postAndConsume, 0);
  }
});

test("a send that fails makes the pass unhealthy", async () => {
  const l = toVoid();
  const w = world({ ladders: { seeding: [l] }, accounts: new Map([[l.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }]]), sendTx: () => { throw new Error("send failed"); } });
  assert.equal(await silenced(() => w.keeper().pass()), 1);
  assert.equal(w.calls.sendTx, 1);
});

test("learn: Hermes without the update yet is waiting, a failed post is a failure", async () => {
  // A series' last close is always one of its closes (midnight, on this clock).
  const s = { pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 25, varWad: 1n, lastAt: (now() / DAY) * DAY - 3n * DAY };
  const w = world({ series: [s] });
  const k = w.keeper();
  assert.equal(await silenced(() => k.learn()), 0);
  assert.equal(await silenced(() => k.learn()), 0); // backing off, still not failing
  const at = stook.closeOf(s, stook.pendingObservations(s, now(), 10)[0]);
  const usable = async () => ({ parsed: { metadata: { prev_publish_time: Number(at) - 1 }, price: { publish_time: Number(at) } }, vaas: [] });
  const w2 = world({ series: [s], hermes: usable, postAndConsume: () => { throw new Error("primary RPC fetch failed"); } });
  const k2 = w2.keeper();
  assert.equal(await silenced(() => k2.learn()), 1);
  assert.equal(await silenced(() => k2.learn()), 1); // cooling down after the failure
});

test("learn passes over an unpostable close only where the program would take the jump", async () => {
  const hermes = async (path) => { const at = Number(path.split("/").pop()); return { parsed: { metadata: { prev_publish_time: at - 1 }, price: { publish_time: at } }, vaas: [] }; };
  // The first post fails for good (a retired guardian set); count the posts after it.
  const run = async (s) => {
    let posts = 0;
    const w = world({ series: [s], hermes, postAndConsume: () => { if (posts++ === 0) throw Object.assign(new Error("failed"), { logs: ["Error Code: GuardianSetExpired"] }); return "sig"; } });
    assert.equal(await silenced(() => w.keeper().learn()), 0);
    return posts;
  };
  const midnight = (now() / DAY) * DAY;
  // Warmed up, the lost close nine days old: on past it.
  assert.ok(await run({ pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 25, varWad: 1n, lastAt: midnight - 10n * DAY }) >= 2);
  // Warming up, the lost close nine days old: the next is too recent to start
  // warm-up from, so the series waits.
  assert.equal(await run({ pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 1, varWad: 0n, lastAt: midnight - 10n * DAY }), 1);
  // Warming up, the lost close 24 days old: the next is where a new series
  // could start, so on past it.
  assert.ok(await run({ pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 1, varWad: 0n, lastAt: midnight - 25n * DAY }) >= 2);
  // A close lost while younger than a week holds any series there.
  assert.equal(await run({ pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 25, varWad: 1n, lastAt: midnight - 3n * DAY }), 1);
});

// A series on chain for the learn loop: each post is refused unless the
// program would take it (`mayObserve`), and one it takes moves the series as
// `Series::observe` does (a return, a restart after a jump while warming up,
// or a new anchor before the first return). `expired(index)` says which
// closes can never be posted.
function learningWorld(start, expired) {
  const pubkey = key();
  const w = { posted: [], refused: [], asked: [], hermesPerPass: [], state: () => w.series[0] };
  w.series = [{ ...start, pubkey }];
  const accounts = new Map();
  const set = (s) => { w.series[0] = s; accounts.set(pubkey.toBase58(), { data: s }); };
  set(w.series[0]);
  let hermesCalls = 0;
  const hermes = async (path) => { hermesCalls++; const at = Number(path.split("/").pop()); w.asked.push(stook.indexOfClose(w.state(), BigInt(at))); return { parsed: { metadata: { prev_publish_time: at - 1 }, price: { publish_time: at } }, vaas: [] }; };
  const postAndConsume = async (_vaas, _feed, makeIxs) => {
    const ix = makeIxs(key())[0];
    const index = ix.data.readUInt32LE(8);
    const s = w.state(), t = now();
    if (!stook.mayObserve(s, index, t)) { w.refused.push(index); throw Object.assign(new Error("failed"), { logs: ["Error Code: SeriesOutOfOrder"] }); }
    if (expired(index)) throw Object.assign(new Error("failed"), { logs: ["Error Code: GuardianSetExpired"] });
    w.posted.push(index);
    const at = stook.closeOf(s, index);
    const last = s.lastAt > 0n ? stook.indexOfClose(s, s.lastAt) : null;
    let nextRound = last === null ? null : last + 1;
    while (nextRound !== null && !stook.hasRound(s, nextRound)) nextRound++;
    if (at < s.lastAt) set({ ...s, lastAt: at });
    else if (!stook.warmedUp(s) && last !== null && index !== nextRound) set({ ...s, observations: 0, varWad: stook.RESTARTED, lastAt: at });
    else set({ ...s, observations: s.observations + 1, varWad: s.varWad > 0n ? s.varWad : 1n, lastAt: at });
    return "sig";
  };
  const made = world({ series: w.series, accounts, hermes, postAndConsume });
  const keeper = made.keeper();
  w.learn = async () => {
    const before = hermesCalls;
    const failing = await silenced(() => keeper.learn());
    w.hermesPerPass.push(hermesCalls - before);
    return failing;
  };
  return w;
}

test("learn: an old cold series reaches a permitted restart past closes it may not take", async () => {
  const midnight = (now() / DAY) * DAY;
  const base = { feedId, periodSecs: 0, closeSecs: 0, clock: 0 };
  const latest = stook.indexAtOrBefore(base, now() - 60n);
  // One close learned 60 days ago. Every close before about 20 days ago was
  // signed by a guardian set the receiver no longer accepts; the rest post.
  const permitted = latest - 20;
  const w = learningWorld({ ...base, active: true, observations: 1, varWad: 0n, lastAt: midnight - 60n * DAY }, (i) => i < permitted);
  const lastBefore = stook.indexOfClose(base, w.state().lastAt);
  for (let n = 0; n < 5 && !w.posted.includes(permitted); n++) assert.equal(await w.learn(), 0);
  assert.ok(w.posted.includes(permitted), `reached the permitted close ${permitted}; posted ${w.posted}`);
  assert.equal(w.posted[0], permitted, "the first post is the restart at the permitted close");
  assert.deepEqual(w.refused, [], "never posts a close the program would refuse");
  assert.ok(w.hermesPerPass.every((n) => n <= 10), `bounded Hermes calls per pass: ${w.hermesPerPass}`);
  // Only the next close and the restart target were asked for, then the
  // closes after the restart.
  assert.deepEqual(w.asked.slice(0, 2), [lastBefore + 1, permitted]);
  assert.ok(w.state().lastAt >= stook.closeOf(base, permitted));
  assert.ok(stook.indexOfClose(base, w.state().lastAt) > lastBefore);
  // From there it learns forward, in order, and warms up.
  for (let n = 0; n < 3; n++) assert.equal(await w.learn(), 0);
  assert.equal(w.state().lastAt, stook.closeOf(base, latest));
  assert.ok(w.state().observations >= 19, `observations ${w.state().observations}`);
  assert.deepEqual(w.refused, []);
});

test("learn: a warming series on a short period, long stale past a lost close, restarts a week back", async () => {
  for (const periodSecs of [300, 3_600]) {
    const base = { feedId, periodSecs, closeSecs: 0, clock: 0 };
    const p = BigInt(periodSecs);
    // Five returns learned, then the keeper was down for 20 days, and the
    // next close can never be posted. The one close the program takes then
    // is a week back, past any scan from the last close on a 5-minute clock.
    const lastAt = ((now() - 20n * DAY) / p) * p;
    const lost = stook.indexOfClose(base, lastAt) + 1;
    const w = learningWorld({ ...base, active: true, observations: 5, varWad: 1n, lastAt }, (i) => i === lost);
    const target = stook.restartTarget(w.state(), now());
    assert.ok(target > lost + 1);
    for (let n = 0; n < 4; n++) assert.equal(await w.learn(), 0);
    assert.equal(w.posted[0], target, `${periodSecs}s: the first post is the restart target`);
    assert.deepEqual(w.asked.slice(0, 2), [lost, target]);
    assert.deepEqual(w.posted, w.posted.map((_, n) => target + n), "then forward in order");
    assert.deepEqual(w.refused, []);
    assert.ok(w.hermesPerPass.every((n) => n <= 10), `bounded Hermes calls per pass: ${w.hermesPerPass}`);
    assert.ok(stook.warmedUp(w.state()), `${periodSecs}s: warmed up again, ${w.state().observations}`);
  }
});

test("learn: a warmed series gets past a batch of unpostable closes to the first that posts", async () => {
  const midnight = (now() / DAY) * DAY;
  const base = { feedId, periodSecs: 0, closeSecs: 0, clock: 0 };
  const start = { ...base, active: true, observations: 25, varWad: 1n, lastAt: midnight - 30n * DAY };
  const first = stook.indexOfClose(base, start.lastAt) + 1;
  // The first ten pending closes can never be posted; the eleventh can, and
  // the program would take the jump to it.
  const eleventh = first + 10;
  assert.ok(stook.mayObserve(start, eleventh, now()));
  const w = learningWorld(start, (i) => i < eleventh);
  for (let n = 0; n < 3 && !w.posted.includes(eleventh); n++) assert.equal(await w.learn(), 0);
  assert.equal(w.posted[0], eleventh, "the first post is the eleventh close");
  // Then on in order, each close a return.
  assert.deepEqual(w.posted, w.posted.map((_, n) => eleventh + n));
  assert.equal(w.state().lastAt, stook.closeOf(base, w.posted.at(-1)));
  assert.equal(w.state().observations, 25 + w.posted.length);
  assert.deepEqual(w.refused, []);
  assert.deepEqual(w.hermesPerPass.slice(0, 2), [10, 10], "ten lost closes, then the eleventh and nine after it");
  // The unpostable ten are asked for once each, never again.
  assert.equal(await w.learn(), 0);
  assert.equal(new Set(w.asked).size, w.asked.length, "no close asked for twice");
  assert.equal(w.state().lastAt, stook.closeOf(base, stook.indexAtOrBefore(base, now() - 60n)));
});

test("learn: pending closes none of which may be taken yet are waiting, not failing", async () => {
  const midnight = (now() / DAY) * DAY;
  const base = { feedId, periodSecs: 0, closeSecs: 0, clock: 0 };
  // Warming up, its next close lost three days ago: nothing may be taken
  // until that close is a week old.
  const w = learningWorld({ ...base, active: true, observations: 1, varWad: 0n, lastAt: midnight - 4n * DAY }, (i) => i === stook.indexOfClose(base, midnight - 3n * DAY));
  for (let n = 0; n < 3; n++) assert.equal(await w.learn(), 0);
  assert.deepEqual(w.posted, []);
  assert.deepEqual(w.refused, []);
  assert.deepEqual(w.hermesPerPass, [1, 0, 0], "the lost close is asked for once");
  let healths = 0;
  const k = { learn: w.learn, pass: async () => 0, clearUp: async () => 0 };
  await silenced(() => watch(k, { interval: 0, beat: () => {}, healthy: () => healths++, passes: 2, sleep: async () => {} }));
  assert.equal(healths, 2);
});

test("clear-up: a round not closable yet is not a failure; other failures are", async () => {
  const treasury = key();
  const config = stook.deriveProtocolConfig();
  const done = ladder({ status: "void", settlesAt: now() - DAY });
  const early = ladder({ status: "void", settlesAt: now() + DAY });
  const accounts = new Map([
    [config.toBase58(), { data: { treasury } }],
    [done.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }],
    [early.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }],
  ]);
  let n = 0;
  const notClosable = () => { if (n++ % 2 === 1) throw Object.assign(new Error("Simulation failed: custom program error: 0x1793"), { logs: ["Error Code: LadderNotClosable"] }); return "sig"; };
  const w = world({ ladders: { void: [done, early] }, accounts, sendTx: notClosable });
  assert.equal(await silenced(() => w.keeper().clearUp()), 0);
  // The round voided before its close is skipped without sending: only `done`'s two.
  assert.equal(w.calls.sendTx, 2);

  const w2 = world({ ladders: { void: [done] }, accounts, sendTx: () => { throw new Error("primary RPC fetch failed"); } });
  assert.equal(await silenced(() => w2.keeper().clearUp()), 1);
});

test("clear-up: a frozen owner is skipped, a failing round backs off, and neither stops the heartbeat", async () => {
  const treasury = key(), owner = key();
  const config = stook.deriveProtocolConfig();
  const done = ladder({ status: "settled", settlesAt: now() - 40n * DAY, openTranches: 1 });
  const ata = (who) => getAssociatedTokenAddressSync(done.quoteMint, who, true, TOKEN_PROGRAM_ID).toBase58();
  const ice = { data: Object.assign(new Uint8Array(165), { 108: 2 }) };
  const accounts = new Map([
    [config.toBase58(), { data: { treasury } }],
    [done.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }],
    [ata(owner), ice],
  ]);
  // An LP's deposit is owed past the grace, to a token account the issuer froze.
  const w = world({ ladders: { settled: [done] }, tranches: { [done.pubkey.toBase58()]: [{ owner, index: 0 }] }, accounts });
  assert.equal(await silenced(() => w.keeper().clearUp()), 0);
  assert.equal(w.calls.sendTx, 0, "no payout sent to a frozen account");

  // A round whose sends keep failing backs off and counts, but the pass beats.
  const gone = ladder({ status: "void", settlesAt: now() - DAY });
  const w2 = world({ ladders: { void: [gone] }, accounts: new Map([[config.toBase58(), { data: { treasury } }], [gone.quoteMint.toBase58(), { owner: TOKEN_PROGRAM_ID }]]), sendTx: () => { throw new Error("frozen"); } });
  const k2 = w2.keeper();
  assert.equal(await silenced(() => k2.clearUp()), 1);
  const sent = w2.calls.sendTx;
  assert.equal(await silenced(() => k2.clearUp()), 1);
  assert.equal(w2.calls.sendTx, sent, "backing off: nothing sent");
  let beats = 0, healths = 0;
  await silenced(() => watch(k2, { interval: 0, beat: () => beats++, healthy: () => healths++, passes: 2, sleep: async () => {} }));
  assert.equal(beats, 2);
  assert.equal(healths, 2);
});

test("a pass that cannot read the chain writes neither signal", async () => {
  const keeper = { learn: async () => 0, clearUp: async () => 0, pass: async () => { throw new Error("429 Too Many Requests"); } };
  let beats = 0, healths = 0;
  await silenced(() => watch(keeper, { interval: 0, beat: () => beats++, healthy: () => healths++, passes: 3, sleep: async () => {} }));
  assert.deepEqual([beats, healths], [0, 0]);
});

test("learn: a run of unpostable closes longer than the scan does not hide the close after it", async () => {
  const { Keypair } = await import("@solana/web3.js");
  const { stook } = await import("@sooth/sdk-solana");
  const { createKeeper, LEARN_SCAN } = await import("../src/index.mjs");
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const start = ((now() - 30n * 86_400n) / 60n) * 60n;
  let s = { feedId: new Uint8Array(32), periodSecs: 60, closeSecs: 0, clock: 0, active: true, observations: 30, varWad: 5n, lastAt: start };
  const first = stook.indexOfClose(s, s.lastAt) + 1, lost = LEARN_SCAN + 4, pubkey = Keypair.generate().publicKey;
  const posts = [];
  const k = createKeeper({
    connection: { async getAccountInfo() { return { data: s }; } },
    scanner: { async getProgramAccounts() { return [{ pubkey, account: { data: s } }]; } },
    payer: Keypair.generate(), sdk: { ...stook, decodeSeries: (d) => d },
    hermes: async (p) => { const at = Number(p.split("/").pop()); return { parsed: { metadata: { prev_publish_time: at - 1 }, price: { publish_time: at } }, vaas: [] }; },
    sendTx: async () => { throw new Error("no sends expected"); },
    postAndConsume: async (_v, _f, mk) => {
      const index = mk(pubkey)[0].data.readUInt32LE(8);
      assert.ok(stook.mayObserve(s, index, now()), `posted a close the program refuses: ${index}`);
      if (index < first + lost) throw Object.assign(new Error("x"), { logs: ["Error Code: GuardianSetExpired"] });
      posts.push(index); s = { ...s, observations: s.observations + 1, lastAt: stook.closeOf(s, index) };
      return "sig";
    },
  });
  const fails = [];
  await silenced(async () => { for (let p = 0; p < Math.ceil(lost / 10) + 3 && !posts.length; p++) fails.push(await k.learn()); });
  assert.equal(posts[0], first + lost, "the first close after the run is the first posted");
  assert.ok(fails.every((f) => f === 0), "passing over unpostable closes is not a failure");
});

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

test("a pass whose primary RPC fails is unhealthy and writes no heartbeat, through the backoff", async () => {
  const w = world({ ladders: { seeding: [toOpen()] }, primaryFails: true });
  const k = w.keeper();
  let beats = 0;
  await silenced(() => watch(k, { interval: 0, beat: () => beats++, passes: 3, sleep: async () => {} }));
  assert.equal(beats, 0);
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
    let beats = 0;
    await silenced(() => watch(w.keeper(), { interval: 0, beat: () => beats++, passes: 2, sleep: async () => {} }));
    assert.equal(beats, 2, JSON.stringify(Object.keys(ladders)));
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
  const s = { pubkey: key(), feedId, periodSecs: 0, closeSecs: 0, clock: 0, observations: 25, varWad: 1n, lastAt: now() - 3n * DAY };
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
  let beats = 0;
  await silenced(() => watch(k2, { interval: 0, beat: () => beats++, passes: 2, sleep: async () => {} }));
  assert.equal(beats, 2);
});

// A series still warming up whose next close can never be posted (its update
// signed by a guardian set since retired). It must not stay cold for good:
// once that close is a week old it may be passed, onto a close a new series
// could start from, and its warm-up starts again there. A backfill cannot be
// steered by skipping the closes nobody has posted yet. The SDK's
// `mayObserve` must say the same as the program at every step.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const updateAt = (price: bigint, publish: bigint, prev: bigint) => { const b = Buffer.from(NVDA_UPDATE); b.writeBigInt64LE(price, 74); b.writeBigInt64LE(publish, 94); b.writeBigInt64LE(prev, 102); return b; };
const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

// A series (daily UTC closing at 20:00 unless said), on a fresh program,
// observed through the SDK: `observe` holds the SDK's `mayObserve` to the
// program's answer, and keeps the compute the transaction took.
const DAILY_UTC = { periodSecs: 0, closeSecs: 20 * 3600, clock: L.CLOCK_UTC };
async function harness(createdAt: number, s0: { periodSecs: number; closeSecs: number; clock: number } = DAILY_UTC) {
  const svm = new LiteSVM(); svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) => ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });
  const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const admin = Keypair.generate(); svm.airdrop(admin.publicKey.toBase58() as any, 10_000_000_000n as any);
  put(config, PROGRAM, Buffer.concat([disc("ProtocolConfig"), admin.publicKey.toBuffer(), Buffer.alloc(32), admin.publicKey.toBuffer(), Buffer.from([0, bump]), Buffer.alloc(30)]));
  const mint = Keypair.generate().publicKey; const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  put(mint, TOKEN_PROGRAM_ID, mintData);
  const send = async (ix: TransactionInstruction, by: Keypair) => {
    const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
    tx.recentBlockhash = svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
    const r = await ctx.banksClient.tryProcessTransaction(tx);
    return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n"), cu: Number(r.meta?.computeUnitsConsumed ?? 0n) };
  };

  const series = L.deriveSeries(NVDA_FEED, mint, s0.periodSecs, PROGRAM);
  const at = (i: number) => L.closeOf(s0, i);
  warpClockTo(ctx, at(createdAt) + 60n);
  const r = await send(L.createSeriesIx({ authority: admin.publicKey, feedId: NVDA_FEED, quoteMint: mint, ...s0, programId: PROGRAM }), admin);
  expect(r.err, r.logs).toBeNull();
  const state = () => L.decodeSeries(new Uint8Array((svm.getAccount(series.toBase58() as any) as any).data));
  const clock = () => BigInt((svm.getClock() as any).unixTimestamp);
  // Observe `index` as `by` (the authority unless said), and hold the SDK's
  // answer to the program's.
  const spent: number[] = [];
  const observe = async (index: number, by = admin) => {
    const predicted = L.mayObserve(state(), index, clock());
    const price = PublicKey.unique(); put(price, PYTH_RECEIVER, updateAt(22_019_000n + BigInt(index % 2) * 30_000n, at(index), at(index) - 1n));
    const res = await send(L.observeSeriesIx(series, by.publicKey, price, index, PROGRAM), by);
    expect(res.err === null, `index ${index}: sdk said ${predicted}\n${res.logs}`).toBe(predicted);
    if (!predicted) expect(res.logs).toContain("SeriesOutOfOrder");
    spent.push(res.cu);
    return predicted;
  };
  return { svm, ctx, at, state, clock, observe, spent };
}

describe("a series warming up past a close that cannot be posted", () => {
  it("passes it only onto a close a new series could start from, and warms up again from there", async () => {
    const D = L.daysFromCivil(2026, 9, 1);
    const { ctx, at, state, observe } = await harness(D + 20);
    // A backfill from 20 closes back. Four closes in, nobody may jump ahead
    // of it, over closes that are more than a week old but still postable:
    // that would pick which returns warm-up counts.
    for (let i = D; i <= D + 3; i++) expect(await observe(i)).toBe(true);
    for (const i of [D + 5, D + 12, D + 14]) expect(await observe(i)).toBe(false);
    for (let i = D + 4; i <= D + 18; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(18);
    expect(L.warmedUp(state())).toBe(false);

    // D + 19 cannot be posted. A day on it is timely, so D + 20 may not pass it.
    expect(await observe(D + 20)).toBe(false);
    warpClockTo(ctx, at(D + 19) + L.SKIP_AFTER_SECS - 1n);
    expect(await observe(D + 20)).toBe(false);
    // A week on it is lost, but D + 20 is too recent to warm up from.
    warpClockTo(ctx, at(D + 19) + L.SKIP_AFTER_SECS + 3600n);
    expect(await observe(D + 20)).toBe(false);

    // Twenty rounds on, D + 20 is where a new series would start: the series
    // lands there, learns no return over the gap, and warms up again.
    warpClockTo(ctx, at(D + 40) + 60n);
    expect(await observe(D + 21)).toBe(false);             // not a close a new series may start from
    expect(await observe(D + 20)).toBe(true);
    expect(state().observations).toBe(0);
    expect(state().varWad).toBe(L.RESTARTED);
    expect(L.seriesVariance(state())).toBe(0n);
    expect(state().lastAt).toBe(at(D + 20));
    expect(await observe(D + 19)).toBe(false);             // never back before it
    expect(await observe(D + 22)).toBe(false);             // then in order again
    for (let i = D + 21; i <= D + 40; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(20);
    expect(L.warmedUp(state())).toBe(true);
  });

  // The auditor's cycle: a backfill from 40 back, an outsider restarts it at
  // 20 back, then anchors it at 40 back again to undo the backfill, and
  // restarts it again, forever. A restart is a floor: the anchoring is
  // refused, there is no second restart at the same clock, and the series
  // warms up forward from the restart.
  it("lets nobody undo a restart by anchoring before it, or restart it again", async () => {
    const N = L.daysFromCivil(2026, 10, 15);
    const { svm, at, state, observe } = await harness(N);
    const outsider = Keypair.generate(); svm.airdrop(outsider.publicKey.toBase58() as any, 10_000_000_000n as any);

    for (let i = N - 40; i <= N - 37; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(3);

    // The one jump there is: exactly onto where a new series starts now.
    expect(await observe(N - 25, outsider)).toBe(false);
    expect(await observe(N - 20, outsider)).toBe(true);
    expect(state().observations).toBe(0);
    expect(L.restarted(state())).toBe(true);
    expect(L.seriesVariance(state())).toBe(0n);
    expect(L.warmedUp(state())).toBe(false);
    expect(state().lastAt).toBe(at(N - 20));
    expect(L.pendingObservations(state(), at(N) + 60n)[0]).toBe(N - 19);

    // The cycle, tried again and again: never back under the restart, never
    // a second restart.
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const i of [N - 40, N - 39, N - 21]) expect(await observe(i, outsider)).toBe(false);
      for (const i of [N - 18, N - 10, N]) expect(await observe(i, outsider)).toBe(false);
      expect(state().lastAt).toBe(at(N - 20));
      expect(state().varWad).toBe(L.RESTARTED);
    }

    // Forward from the restart, whoever submits: the first return starts
    // the variance from zero, and the series is warm by now.
    expect(await observe(N - 19, outsider)).toBe(true);
    expect(state().observations).toBe(1);
    expect(state().varWad > 0n).toBe(true);
    expect(L.restarted(state())).toBe(false);
    for (const i of [N - 40, N - 20]) expect(await observe(i, outsider)).toBe(false);
    for (let i = N - 18; i <= N; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(20);
    expect(L.warmedUp(state())).toBe(true);
    const sigma = Math.sqrt(Number(state().varWad) / 1e18);
    expect(sigma).toBeGreaterThan(0.001);
    expect(sigma).toBeLessThan(0.3);
  });

  // Twenty periods back on an hourly clock is never a week past anything, so
  // there the one close the series may jump to is the one after the last
  // close a week old. It lands there, and warms up again.
  it("recovers on a short period too, from a week back", async () => {
    const hourly = { periodSecs: 3600, closeSecs: 0, clock: L.CLOCK_UTC };
    const N = Math.floor(1_790_000_000 / 3600);
    const { ctx, at, state, clock, observe } = await harness(N, hourly);
    for (let i = N - 25; i <= N - 20; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(5);
    const lost = N - 19;
    for (const days of [8n, 10n, 20n, 44n]) {
      warpClockTo(ctx, at(lost) + days * 86_400n + 60n);
      const now = clock();
      const latest = L.indexAtOrBefore(hourly, now);
      const target = L.restartTarget(state(), now);
      const allowed: number[] = [];
      for (let i = lost + 1; i <= latest; i++) if (L.mayObserve(state(), i, now)) allowed.push(i);
      expect(allowed, `${days} days on`).toEqual([target]);
      expect(target).toBeLessThan(L.seriesFrontier(state(), now));
      expect(at(target - 1) <= now - L.SKIP_AFTER_SECS && at(target) > now - L.SKIP_AFTER_SECS).toBe(true);
      for (const i of [lost + 1, L.seriesFrontier(state(), now), target + 1]) expect(await observe(i)).toBe(false);
    }
    const target = L.restartTarget(state(), clock());
    expect(await observe(target)).toBe(true);
    expect(state().varWad).toBe(L.RESTARTED);
    expect(state().lastAt).toBe(at(target));
    for (const i of [lost, target - 1, target + 2]) expect(await observe(i)).toBe(false);
    for (let i = target + 1; i <= target + 20; i++) expect(await observe(i)).toBe(true);
    expect(L.warmedUp(state())).toBe(true);
  });
});

// A close taken in order costs no more than the keeper's consume transaction
// holds (200,000 units, beside the Pyth read): only anchoring and a jump count
// rounds back from now, which on a weekday clock is the costly part.
describe("a weekday series learning in order", () => {
  it("takes each close within the keeper's compute budget", async () => {
    const weekdays = { periodSecs: 0, closeSecs: 16 * 3600, clock: L.CLOCK_NEW_YORK_WEEKDAYS };
    const N = L.daysFromCivil(2026, 11, 20);
    const { observe, spent } = await harness(N, weekdays);
    const start = L.roundsBack(weekdays, N, 20);
    expect(await observe(start)).toBe(true);
    const inOrder: number[] = [];
    for (let i = start + 1; i <= N; i++) {
      if (!L.hasRound(weekdays, i)) continue;
      expect(await observe(i)).toBe(true);
      inOrder.push(spent[spent.length - 1]);
    }
    expect(inOrder.length).toBe(20);
    expect(Math.max(...inOrder)).toBeLessThan(200_000);
  });
});

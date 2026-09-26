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

describe("a series warming up past a close that cannot be posted", () => {
  it("passes it only onto a close a new series could start from, and warms up again from there", async () => {
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
      const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix);
      tx.recentBlockhash = svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
      const r = await ctx.banksClient.tryProcessTransaction(tx);
      return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n") };
    };

    // A daily UTC series closing at 20:00, created in September 2026.
    const s0 = { periodSecs: 0, closeSecs: 20 * 3600, clock: L.CLOCK_UTC };
    const series = L.deriveSeries(NVDA_FEED, mint, 0, PROGRAM);
    const D = L.daysFromCivil(2026, 9, 1);
    const at = (i: number) => L.closeOf(s0, i);
    warpClockTo(ctx, at(D + 20) + 60n);
    let r = await send(L.createSeriesIx({ authority: admin.publicKey, feedId: NVDA_FEED, quoteMint: mint, ...s0, programId: PROGRAM }), admin);
    expect(r.err, r.logs).toBeNull();
    const state = () => L.decodeSeries(new Uint8Array((svm.getAccount(series.toBase58() as any) as any).data));
    const clock = () => BigInt((svm.getClock() as any).unixTimestamp);
    // Observe `index`, and hold the SDK's answer to the program's.
    const observe = async (index: number) => {
      const predicted = L.mayObserve(state(), index, clock());
      const price = PublicKey.unique(); put(price, PYTH_RECEIVER, updateAt(22_019_000n + BigInt(index % 2) * 30_000n, at(index), at(index) - 1n));
      const res = await send(L.observeSeriesIx(series, admin.publicKey, price, index, PROGRAM), admin);
      expect(res.err === null, `index ${index}: sdk said ${predicted}\n${res.logs}`).toBe(predicted);
      if (!predicted) expect(res.logs).toContain("SeriesOutOfOrder");
      return predicted;
    };

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
    expect(state().varWad).toBe(0n);
    expect(state().lastAt).toBe(at(D + 20));
    expect(await observe(D + 22)).toBe(false);             // then in order again
    for (let i = D + 21; i <= D + 40; i++) expect(await observe(i)).toBe(true);
    expect(state().observations).toBe(20);
    expect(L.warmedUp(state())).toBe(true);
  });
});

// A transfer fee raised between the quote and the send, on the $STOOK mint
// (the fee-bearing fixture of `ladder-stook.test.ts`), with its fee authority
// handed to the test so the issuer's own instruction can schedule the change.
//
// Token-2022 applies a new fee two epochs after it is set. A wallet that
// quoted in the epoch before signs for what it was shown: a deposit's most
// gross, a sale's least net. At the epoch the 99% fee takes effect, every one
// of those transactions must fail whole, not take 100 times the quote or pay
// a fraction of the minimum, and leave the balances and the pool as they were.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, TOKEN_2022_PROGRAM_ID, createSetTransferFeeInstruction } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { Clock, SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";
import { testSeries, warmCloses } from "./fixtures/series";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const STOOK = new Uint8Array(Buffer.from(readFileSync(resolve(__dirname, "fixtures/stook-mint.hex"), "utf8").trim(), "hex"));
const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const PUBLISH_TIME = 1_780_598_260n;
const updateAt = (price: bigint, publish: bigint, prev: bigint) => { const b = Buffer.from(NVDA_UPDATE); b.writeBigInt64LE(price, 74); b.writeBigInt64LE(publish, 94); b.writeBigInt64LE(prev, 102); return b; };
const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const T = 1_000_000n; // one STOOK
const ACCOUNT_TAIL = Buffer.from([2, 2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
// The TransferFeeConfig extension's value starts here in the fixture; its
// first 32 bytes are the fee authority.
const FEE_AUTHORITY_AT = 238;
const HIGH_CAP = 1_000_000_000_000_000n;

function boot() {
  const svm = new LiteSVM(); svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) => ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });
  const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const admin = Keypair.generate(); svm.airdrop(admin.publicKey.toBase58() as any, 10_000_000_000n as any);
  put(config, PROGRAM, Buffer.concat([disc("ProtocolConfig"), admin.publicKey.toBuffer(), Buffer.alloc(32), admin.publicKey.toBuffer(), Buffer.from([0, bump]), Buffer.alloc(30)]));
  const mintData = Buffer.from(STOOK); admin.publicKey.toBuffer().copy(mintData, FEE_AUTHORITY_AT);
  const mint = Keypair.generate().publicKey; put(mint, TOKEN_2022_PROGRAM_ID, mintData);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const base = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, base);
    put(key, TOKEN_2022_PROGRAM_ID, Buffer.concat([base, ACCOUNT_TAIL])); return key;
  };
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, 10_000n * T) }; };
  const creator = who(), lp = who(), trader = who();
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };
  return { svm, ctx, admin, mint, creator, lp, trader, priceAccount };
}
type Env = ReturnType<typeof boot>;
async function send(e: Env, ix: TransactionInstruction, by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, ix, by); expect(r.err, r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, ix, by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => e.svm.getAccount(k.toBase58() as any) as any;
const data = (e: Env, k: PublicKey) => { const a = raw(e, k); return a && BigInt(a.lamports ?? 0) > 0n ? Buffer.from(a.data).toString("hex") : null; };
const balance = (e: Env, k: PublicKey) => AccountLayout.decode(Buffer.from(raw(e, k).data).subarray(0, ACCOUNT_SIZE)).amount;
const setEpoch = (e: Env, epoch: bigint) => { const c = e.ctx.svm.getClock(); e.ctx.setClock(new Clock(c.slot, c.epochStartTimestamp, epoch, epoch, c.unixTimestamp)); };

describe("a transfer fee raised between the quote and the send", () => {
  it("fails a deposit, a round's creation and a sale signed at the old fee, and changes nothing", async () => {
    const e = boot();
    setEpoch(e, 1040n);
    const fee = L.classifyMint(new Uint8Array(raw(e, e.mint).data), 1040n).transferFee!;
    expect(fee).toEqual({ bps: 100, maxFee: HIGH_CAP });

    const settlesAt = PUBLISH_TIME + 3700n;
    const ser = testSeries(NVDA_FEED, e.mint, settlesAt, e.admin.publicKey, PROGRAM);
    const key = { series: ser.series, index: ser.index, quoteMint: e.mint };
    const ladder = L.deriveLadderPda(key, PROGRAM);
    const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_2022_PROGRAM_ID, programId: PROGRAM };
    const vault = L.deriveLadderVault(ladder, PROGRAM);
    const state = () => L.decodeLadder(new Uint8Array(raw(e, ladder).data));
    const quote = (shape: L.Shape, shares: bigint) => {
      const m = state();
      return L.quoteTrade({ curve: m.curve, b: m.b, feeBps: L.feeBpsAt(m.feeBps, BigInt((e.svm.getClock() as any).unixTimestamp), m.settlesAt), decimals: m.decimals }, shape, shares);
    };
    const trade = (shape: L.Shape, shares: bigint, limit: bigint) => L.tradeLadderIx(refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape, shares, limit });

    warpClockTo(e.ctx, PUBLISH_TIME - 60n);
    await ok(e, ser.createIx(), e.admin);
    const closes = warmCloses(ser.indexOf, ser.closeOf, PUBLISH_TIME - 1000n, 22_019_000n);
    warpClockTo(e.ctx, closes.at(-1)!.at + 1n);
    for (const c of closes) await ok(e, L.observeSeriesIx(ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(c.price, c.at, c.at - 1n)), c.index, PROGRAM), e.trader.kp);
    warpClockTo(e.ctx, PUBLISH_TIME - 60n);
    await ok(e, L.approveQuoteMintIx(e.admin.publicKey, e.mint, PROGRAM), e.admin);

    // ── at a fixed fee, a round starts on the gross it was quoted ───────────
    const c0 = balance(e, e.creator.token);
    await ok(e, L.createLadderIx({ ...key, creator: e.creator.kp.publicKey, creatorToken: e.creator.token, tokenProgram: TOKEN_2022_PROGRAM_ID, seed: 1_000n * T, maxGross: L.maxGrossFor(1_000n * T, [fee]), issuerTrusted: true, programId: PROGRAM }), e.creator.kp);
    expect(c0 - balance(e, e.creator.token)).toBe(L.grossFor(1_000n * T, fee));
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await ok(e, L.openLadderIx(refs, e.trader.kp.publicKey, e.priceAccount(updateAt(22_019_000n, PUBLISH_TIME, PUBLISH_TIME - 1n)), ser.series), e.trader.kp);
    const W = L.binFor(22_460_000n, state().p0, state().stepBps);
    for (const [shape, shares] of [[L.band(20, 44), 30n * T], [L.tent(W, 4), 10n * T]] as const) {
      await ok(e, trade(shape, shares, L.maxGrossFor(quote(shape, shares).total, [fee])), e.trader.kp);
    }

    // ── the issuer schedules 99%, in force two epochs on ────────────────────
    await ok(e, createSetTransferFeeInstruction(e.mint, e.admin.publicKey, [], 9_900, HIGH_CAP, TOKEN_2022_PROGRAM_ID), e.admin);
    setEpoch(e, 1041n);
    const seen = L.classifyMint(new Uint8Array(raw(e, e.mint).data), 1041n);
    expect(seen.transferFee).toEqual(fee);                                  // still 1% now
    expect(seen.nextTransferFee).toEqual({ bps: 9_900, maxFee: HIGH_CAP, epoch: 1042n });

    // ── the old fee still in force: a deposit and a sale land as quoted ─────
    const l0 = balance(e, e.lp.token);
    await ok(e, L.joinLadderIx(refs, { lp: e.lp.kp.publicKey, lpToken: e.lp.token, index: 0, deposit: 100n * T, expectedSeq: state().curveSeq, maxGross: L.maxGrossFor(100n * T, [fee]) }), e.lp.kp);
    expect(l0 - balance(e, e.lp.token)).toBe(101_010_102n);                 // the audit's quote, paid exactly
    {
      // A limit of exactly what lands, the fee rounded up as Token-2022 does:
      // a unit more fails, the exact amount goes through.
      const q = quote(L.tent(W, 4), -10n * T), exact = L.minNetOf(q.total, [fee], 0n), had = balance(e, e.trader.token);
      expect(exact).toBe(L.netOf(q.total, fee));
      await refused(e, trade(L.tent(W, 4), -10n * T, exact + 1n), e.trader.kp, "SlippageExceeded");
      expect(balance(e, e.trader.token)).toBe(had);
      await ok(e, trade(L.tent(W, 4), -10n * T, exact), e.trader.kp);
      expect(balance(e, e.trader.token) - had).toBe(exact);
    }

    // ── quoted and signed now, at 1%: what the app would send ───────────────
    const join = L.joinLadderIx(refs, { lp: e.lp.kp.publicKey, lpToken: e.lp.token, index: 1, deposit: 50n * T, expectedSeq: state().curveSeq, maxGross: L.maxGrossFor(50n * T, [fee]) });
    const nextKey = { ...key, index: ser.index + 1 };
    const create = L.createLadderIx({ ...nextKey, creator: e.creator.kp.publicKey, creatorToken: e.creator.token, tokenProgram: TOKEN_2022_PROGRAM_ID, seed: 10n * T, maxGross: L.maxGrossFor(10n * T, [fee]), issuerTrusted: true, programId: PROGRAM });
    const sale = quote(L.band(20, 44), -30n * T);
    const shown = L.minNetOf(sale.total, [fee]);                            // the ticket's "at least"
    const sell = trade(L.band(20, 44), -30n * T, shown);

    // ── the 99% fee takes effect; each fails whole ──────────────────────────
    setEpoch(e, 1042n);
    const wallets = [e.lp.token, e.creator.token, e.trader.token, vault];
    const before = { balances: wallets.map((k) => balance(e, k)), ladder: data(e, ladder), position: data(e, L.deriveLadderPosition(ladder, e.trader.kp.publicKey, L.band(20, 44), PROGRAM)) };
    const now = () => ({ balances: wallets.map((k) => balance(e, k)), ladder: data(e, ladder), position: data(e, L.deriveLadderPosition(ladder, e.trader.kp.publicKey, L.band(20, 44), PROGRAM)) });
    // Unbounded, the join would have taken 5,000 STOOK for 50 credited, the
    // round 1,000 for a seed of 10, and the sale paid about 1% of its minimum.
    expect(L.grossFor(50n * T, { bps: 9_900, maxFee: HIGH_CAP })).toBe(5_000n * T);
    await refused(e, join, e.lp.kp, "SlippageExceeded");
    await refused(e, create, e.creator.kp, "SlippageExceeded");
    await refused(e, sell, e.trader.kp, "SlippageExceeded");
    expect(now()).toEqual(before);
    expect(data(e, L.deriveLadderPda(nextKey, PROGRAM))).toBeNull();
    expect(data(e, L.deriveLadderTranche(ladder, e.lp.kp.publicKey, 1, PROGRAM))).toBeNull();

    // ── requoted at the fee in force, the sale goes through ─────────────────
    const next = seen.nextTransferFee!;
    const min = L.minNetOf(sale.total, [next]), had = balance(e, e.trader.token);
    await ok(e, trade(L.band(20, 44), -30n * T, min), e.trader.kp);
    const got = balance(e, e.trader.token) - had;
    expect(got).toBe(L.netOf(sale.total, next));
    expect(got).toBeGreaterThanOrEqual(min);

    // ── a fee capped low: 50%, but never more than 0.01 STOOK a transfer ────
    const capped = { bps: 5_000, maxFee: T / 100n };
    await ok(e, createSetTransferFeeInstruction(e.mint, e.admin.publicKey, [], capped.bps, capped.maxFee, TOKEN_2022_PROGRAM_ID), e.admin);
    setEpoch(e, 1044n);
    expect(L.classifyMint(new Uint8Array(raw(e, e.mint).data), 1044n).transferFee).toEqual(capped);
    const buy = quote(L.band(20, 44), 5n * T), paid = balance(e, e.trader.token);
    await ok(e, trade(L.band(20, 44), 5n * T, L.maxGrossFor(buy.total, [capped])), e.trader.kp);
    expect(paid - balance(e, e.trader.token)).toBe(buy.total + capped.maxFee);
    const back = quote(L.band(20, 44), -5n * T), exact = L.minNetOf(back.total, [capped], 0n), held = balance(e, e.trader.token);
    expect(exact).toBe(back.total - capped.maxFee);                         // the cap, not half
    await refused(e, trade(L.band(20, 44), -5n * T, exact + 1n), e.trader.kp, "SlippageExceeded");
    expect(balance(e, e.trader.token)).toBe(held);
    await ok(e, trade(L.band(20, 44), -5n * T, exact), e.trader.kp);
    expect(balance(e, e.trader.token) - held).toBe(exact);
    console.log(`\nFEE CHANGE  1% → 99% between quote and send · join, create and sale signed at 1% all refused, nothing moved · sale requoted at 99% received ${got} ≥ ${min} · at 50% capped, a sale limited to exactly what lands went through, a unit more did not\n`);
  });

  it("signs at the fee in force and says when a scheduled one would cost more", () => {
    const now = { bps: 100, maxFee: HIGH_CAP }, next = { bps: 9_900, maxFee: HIGH_CAP };
    expect(L.maxGrossFor(100n * T, [now])).toBe(L.grossFor((100n * T * 10_050n) / 10_000n, now));
    expect(L.maxGrossFor(100n * T, [now, next])).toBe(L.grossFor((100n * T * 10_050n) / 10_000n, next));
    expect(L.maxGrossFor(100n * T, [next, now])).toBe(L.maxGrossFor(100n * T, [now, next]));
    expect(L.maxGrossFor(100n * T, [undefined], 0n)).toBe(100n * T);
    expect(L.minNetOf(100n * T, [now, next])).toBe(L.netOf((100n * T * 9_950n) / 10_000n, next));
    expect(L.minNetOf(100n * T, [now], 0n)).toBe(L.netOf(100n * T, now));
    // a fee capped low takes less than the rate says
    expect(L.minNetOf(100n * T, [{ bps: 9_900, maxFee: T }], 0n)).toBe(99n * T);
    // what the app asks before it warns: only a costlier next fee counts, and
    // one that takes everything is never priced (grossFor would throw)
    expect(L.feeRaises(100n * T, now, next)).toBe(true);
    expect(L.feeRaises(100n * T, next, now)).toBe(false);
    expect(L.feeRaises(100n * T, now, undefined)).toBe(false);
    expect(L.feeRaises(100n * T, now, { bps: 9_900, maxFee: 0n })).toBe(false);
    expect(L.feeRaises(100n * T, now, { bps: 10_000, maxFee: HIGH_CAP })).toBe(true);
    expect(L.feeRaises(100n * T, undefined, { bps: 10, maxFee: HIGH_CAP })).toBe(true);
  });
});

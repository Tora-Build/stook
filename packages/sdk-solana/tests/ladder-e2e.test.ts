// The ladder, end to end on LiteSVM against the real program binary.
//
//   settle path: seed (two LPs, a third joins mid-market) → open from a REAL Pyth account → trade →
//                settle → winners redeem → LPs claim → fees → vault empty
//   void path:   trade → settlement price never arrives → void →
//                trader refunded exactly what they paid, LP made whole
//
// Every instruction is built by the SDK, and every trade is quoted by the SDK
// first: the trade is sent with its limit set to the quote EXACTLY, so a port
// that was one base unit off would fail the buy or the sell. After each trade
// the curve the SDK predicted is compared, weight for weight, with the chain's.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");

// Equity.US.NVDA/USD, devnet account ics9eca…, read 2026-09-21: $220.19, 5 signatures.
const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const PUBLISH_TIME = 1_780_598_260n;
const P0 = 22_019_000n;

/** The real update's bytes with price and times replaced. SYNTHETIC: LiteSVM
 *  lets a test write any account, so this exercises the program's settlement
 *  rule, not Pyth's signatures. Offsets are for the Partial (2-byte) variant. */
const updateAt = (price: bigint, publish: bigint, prev: bigint) => {
  const b = Buffer.from(NVDA_UPDATE);
  b.writeBigInt64LE(price, 74); b.writeBigInt64LE(publish, 94); b.writeBigInt64LE(prev, 102);
  return b;
};

const disc = (ns: string, name: string) => createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8);

const TIER = 2; // 1% steps

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Buffer) =>
    ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data: new Uint8Array(data) });

  const treasury = Keypair.generate();
  svm.airdrop(treasury.publicKey.toBase58() as any, 10_000_000_000n as any);
  const config = L.deriveProtocolConfig(PROGRAM);

  const mint = Keypair.generate().publicKey;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  put(mint, TOKEN_PROGRAM_ID, mintData);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, TOKEN_PROGRAM_ID, d); return key;
  };
  const who = (start: bigint) => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, start), start }; };
  const START = 10_000_000_000n;
  const creator = who(START), lp2 = who(START), lp3 = who(START), trader = who(START);
  const treasuryToken = fund(treasury.publicKey, 0n);
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };

  return { svm, ctx, config, treasury, mint, creator, lp2, lp3, trader, treasuryToken, priceAccount };
}
type Env = ReturnType<typeof boot>;

async function send(e: Env, ixs: TransactionInstruction[], by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, cu: Number(r.meta?.computeUnitsConsumed ?? 0n), logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, [ix], by); expect(r.err, r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, [ix], by); expect(r.err).not.toBeNull(); return r; };

const balance = (e: Env, key: PublicKey) => AccountLayout.decode(Buffer.from((e.svm.getAccount(key.toBase58() as any) as any).data)).amount;
const exists = (e: Env, key: PublicKey) => { const a: any = e.svm.getAccount(key.toBase58() as any); return !!a && (a.exists ?? true) && BigInt(a.lamports ?? 0) > 0n; };

function market(e: Env, settlesAt: bigint) {
  const key = { feedId: NVDA_FEED, settlesAt, quoteMint: e.mint, tier: TIER };
  const ladder = L.deriveLadderPda(key, PROGRAM);
  const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM };
  const vault = L.deriveLadderVault(ladder, PROGRAM);
  const raw = (k: PublicKey) => new Uint8Array((e.svm.getAccount(k.toBase58() as any) as any).data);
  const state = () => L.decodeLadder(raw(ladder));
  const trancheOf = (o: PublicKey, index = 0) => L.deriveLadderTranche(ladder, o, index, PROGRAM);
  const posOf = (o: PublicKey, lo: number, hi: number, h: number) => L.deriveLadderPosition(ladder, o, { lo, hi, h }, PROGRAM);
  const tradeAs = (w: Env["lp2"], lo: number, hi: number, h: number, shares: bigint, limit: bigint) =>
    L.tradeLadderIx(refs, { user: w.kp.publicKey, userToken: w.token, shape: { lo, hi, h }, shares, limit });

  // Quote with the SDK, send with the quote as the limit, and hold the chain to it.
  const quoted = async (lo: number, hi: number, h: number, shares: bigint) => {
    const before = state(), had = balance(e, e.trader.token);
    const q = L.quoteTrade({ curve: before.curve, b: before.b, feeBps: before.feeBps, decimals: before.decimals }, { lo, hi, h }, shares);
    const r = await ok(e, tradeAs(e.trader, lo, hi, h, shares, q.total), e.trader.kp);
    const moved = balance(e, e.trader.token) - had;
    expect(moved).toBe(shares > 0n ? -q.total : q.total);
    const after = state();
    expect(after.curve.sum).toBe(q.curve.sum);
    expect(after.curve.w).toEqual(q.curve.w);
    expect(after.curveSeq).toBe(before.curveSeq + 1n);
    return r;
  };

  return {
    ladder, vault, trancheOf, posOf, state, tradeAs, quoted,
    tranche: (o: PublicKey, index = 0) => L.decodeLadderTranche(raw(trancheOf(o, index))),
    position: (lo: number, hi: number, h: number) => L.decodeLadderPosition(raw(posOf(e.trader.kp.publicKey, lo, hi, h))),
    curveSeq: () => state().curveSeq,
    depthOf: (o: PublicKey, index = 0) => L.decodeLadderTranche(raw(trancheOf(o, index))).b,
    create: (seed: bigint) => L.createLadderIx({
      ...key, creator: e.creator.kp.publicKey, creatorToken: e.creator.token, tokenProgram: TOKEN_PROGRAM_ID,
      seed, programId: PROGRAM,
    }),
    join: (w: Env["lp2"], amount: bigint, seq: bigint, index = 0) =>
      L.joinLadderIx(refs, { lp: w.kp.publicKey, lpToken: w.token, index, deposit: amount, expectedSeq: seq }),
    open: (price: PublicKey) => L.openLadderIx(refs, e.trader.kp.publicKey, price),
    trade: (lo: number, hi: number, h: number, shares: bigint, limit: bigint) => tradeAs(e.trader, lo, hi, h, shares, limit),
    settle: (price: PublicKey) => L.settleLadderIx(refs, e.trader.kp.publicKey, price, e.trader.token),
    voidIt: () => L.voidLadderIx(refs, e.trader.kp.publicKey),
    redeem: (lo: number, hi: number, h: number) => L.redeemLadderIx(refs, e.trader.kp.publicKey, e.trader.token, { lo, hi, h }),
    claimLp: (w: Env["lp2"], index = 0) => L.claimLpIx(refs, w.kp.publicKey, w.token, index),
    collectFees: () => L.collectLadderFeesIx(refs, e.trader.kp.publicKey, e.creator.token, e.treasuryToken),
  };
}

const BIG = 10n ** 12n;

describe("ladder end to end", () => {
  it("seeds, opens from a real Pyth update, trades, settles, and pays everyone until the vault is empty", async () => {
    const e = boot();
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const m = market(e, settlesAt);
    await ok(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury);
    await refused(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury); // once
    expect(L.decodeProtocolConfig(new Uint8Array((e.svm.getAccount(e.config.toBase58() as any) as any).data)).treasury.equals(e.treasury.publicKey)).toBe(true);

    // ── Seeding: the creator, then a second LP ─────────────────────────────
    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    const create = await ok(e, m.create(5_000_000_000n), e.creator.kp);
    await ok(e, m.join(e.lp2, 2_500_000_000n, 0n), e.lp2.kp);
    expect(balance(e, m.vault)).toBe(7_500_000_000n);

    // ── Open, from the real update ──────────────────────────────────────────
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await refused(e, m.trade(31, 31, 1, 1_000_000n, BIG), e.trader.kp);           // not open yet
    const open = await ok(e, m.open(e.priceAccount(NVDA_UPDATE)), e.trader.kp);

    // ── Trading ─────────────────────────────────────────────────────────────
    const tent = await m.quoted(29, 35, 4, 100_000_000n);                           // a line at bin 32
    const band = await m.quoted(20, 44, 1, 200_000_000n);                           // a wide band
    await refused(e, m.trade(29, 35, 4, 100_000_000n, 1n), e.trader.kp);            // slippage limit
    const sell = await m.quoted(29, 35, 4, -100_000_000n);                          // exit the first line
    await refused(e, m.trade(29, 35, 4, -1n, 0n), e.trader.kp);                     // nothing left to sell

    // ── A third LP joins a market that is already trading ───────────────────
    const seq = m.curveSeq();
    expect(seq).toBe(3n);
    await refused(e, m.join(e.lp3, 2_500_000_000n, seq - 1n), e.lp3.kp);            // priced against a curve that has moved on
    // The sandwich, as one atomic transaction: push a bin, land the LP's join
    // at the pushed prices, trade back. lp3 plays both parts so one signature
    // covers it; what is refused is the join, and with it the whole attempt.
    const sandwich = await send(e, [
      m.tradeAs(e.lp3, 33, 33, 1, 900_000_000n, BIG),
      m.join(e.lp3, 2_500_000_000n, seq),
      m.tradeAs(e.lp3, 33, 33, 1, -900_000_000n, 0n),
    ], e.lp3.kp);
    expect(sandwich.err).not.toBeNull();
    expect(sandwich.logs).toContain("LadderCurveMoved");
    expect(balance(e, e.lp3.token)).toBe(e.lp3.start);                              // and nothing moved
    const predictedDepth = L.liquidityForDeposit(m.state().curve, 2_500_000_000n, 6);
    const join = await ok(e, m.join(e.lp3, 2_500_000_000n, seq), e.lp3.kp);
    expect(m.depthOf(e.lp3.kp.publicKey)).toBe(predictedDepth);
    expect(m.tranche(e.lp3.kp.publicKey).join.w).toEqual(m.state().curve.w);
    await refused(e, m.join(e.lp3, 2_500_000_000n, seq), e.lp3.kp);                 // a tranche index is used once
    // Same deposit as lp2, less depth: the longest shot is longer than 1/64 now,
    // and a tranche must cover its own worst case.
    expect(m.depthOf(e.lp3.kp.publicKey)).toBeLessThan(m.depthOf(e.lp2.kp.publicKey));
    expect(m.depthOf(e.creator.kp.publicKey)).toBe(2n * m.depthOf(e.lp2.kp.publicKey));

    // a clean round trip never pays
    const rt0 = balance(e, e.trader.token);
    await m.quoted(50, 52, 2, 50_000_000n);
    await m.quoted(50, 52, 2, -50_000_000n);
    expect(balance(e, e.trader.token) - rt0).toBeLessThan(0n);

    // the line that will win: a tent centred on bin 33
    await m.quoted(30, 36, 4, 100_000_000n);
    // the widest possible trade on a market whose weights have all grown — the
    // compute worst case; must stay inside the SDK's default limit
    await m.quoted(0, 63, 1, 1_500_000_000n);
    const widest = await m.quoted(0, 63, 1, 300_000_000n);
    expect(widest.cu).toBeLessThan(120_000);
    await m.quoted(0, 63, 1, -1_800_000_000n);
    // an edge tent: its taper runs off the ladder, and the quote still holds
    await m.quoted(-2, 4, 4, 10_000_000n);
    await m.quoted(-2, 4, 4, -10_000_000n);
    expect(m.position(30, 36, 4).shares).toBe(100_000_000n);

    // ── Settlement ──────────────────────────────────────────────────────────
    await refused(e, m.settle(e.priceAccount(updateAt(22_460_000n, settlesAt, settlesAt - 1n))), e.trader.kp); // too early
    warpClockTo(e.ctx, locksAt + 1n);
    await refused(e, m.trade(30, 36, 4, 1_000_000n, BIG), e.trader.kp);             // locked
    warpClockTo(e.ctx, settlesAt + 5n);

    // $224.60 → ln(224.60/220.19)/0.01 = 1.98 → bin 33
    const price = 22_460_000n;
    await refused(e, m.settle(e.priceAccount(updateAt(price, settlesAt, settlesAt))), e.trader.kp);        // a LATER update in second T
    await refused(e, m.settle(e.priceAccount(updateAt(price, settlesAt - 1n, settlesAt - 2n))), e.trader.kp); // from before T
    await refused(e, m.settle(e.priceAccount(updateAt(price, settlesAt + 31n, settlesAt - 1n))), e.trader.kp); // feed silent across T
    const bountyBefore = balance(e, e.trader.token);
    const settle = await ok(e, m.settle(e.priceAccount(updateAt(price, settlesAt, settlesAt - 1n))), e.trader.kp);
    const bounty = balance(e, e.trader.token) - bountyBefore;
    expect(bounty).toBeGreaterThan(0n);                                                                    // the settler is paid
    expect(bounty).toBe(L.settleBounty(m.state().feesProtocol + bounty));
    await refused(e, m.settle(e.priceAccount(updateAt(price, settlesAt, settlesAt - 1n))), e.trader.kp);   // only once
    await refused(e, m.voidIt(), e.trader.kp);                                                             // settled markets do not void

    // ── Everyone collects ───────────────────────────────────────────────────
    const pre = balance(e, e.trader.token);
    const redeem = await ok(e, m.redeem(30, 36, 4), e.trader.kp);
    expect(balance(e, e.trader.token) - pre).toBe(400_000_000n);      // centre bin: 4 × 100
    const pre2 = balance(e, e.trader.token);
    await ok(e, m.redeem(20, 44, 1), e.trader.kp);
    expect(balance(e, e.trader.token) - pre2).toBe(200_000_000n);     // flat band: 1 × 200
    await ok(e, m.redeem(29, 35, 4), e.trader.kp);                    // sold out: pays 0, returns rent
    await ok(e, m.redeem(50, 52, 2), e.trader.kp);
    expect(exists(e, m.posOf(e.trader.kp.publicKey, 30, 36, 4))).toBe(false);
    await refused(e, m.redeem(30, 36, 4), e.trader.kp);               // and cannot be redeemed twice

    const m0 = m.depthOf(e.lp2.kp.publicKey), m1 = m.depthOf(e.lp3.kp.publicKey);
    // what the SDK says lp3 is owed, before it claims
    const fin = m.state(), t3 = m.tranche(e.lp3.kp.publicKey), k = fin.settledBin!;
    expect(k).toBe(33);
    expect(L.binFor(22_460_000n, fin.p0, fin.stepBps)).toBe(33);
    const lp3Predicted =
      L.tranchePrincipal(t3.deposit, L.tranchePnl(t3.b, t3.join.w[k]!, t3.join.sum, fin.curve.w[k]!, fin.curve.sum), 6) +
      L.trancheFees(t3.b, 6, fin.accFee, t3.feeSnap);
    const c0 = balance(e, e.creator.token), l0 = balance(e, e.lp2.token), t0 = balance(e, e.lp3.token);
    await ok(e, m.claimLp(e.lp3), e.lp3.kp);                          // claim order is free: the late LP goes first
    const claim = await ok(e, m.claimLp(e.creator), e.creator.kp);
    await ok(e, m.claimLp(e.lp2), e.lp2.kp);
    const creatorGot = balance(e, e.creator.token) - c0, lp2Got = balance(e, e.lp2.token) - l0, lp3Got = balance(e, e.lp3.token) - t0;
    // Same prices at joining, 5,000 : 2,500 → 2 : 1, to within a base unit of flooring
    expect(creatorGot - 2n * lp2Got).toBeGreaterThanOrEqual(-3n);
    expect(creatorGot - 2n * lp2Got).toBeLessThanOrEqual(3n);
    // The late tranche answers only for flow after it joined, and for less depth.
    expect(lp3Got).toBe(lp3Predicted);
    await refused(e, m.claimLp(e.lp2), e.lp2.kp);

    await ok(e, m.collectFees(), e.trader.kp);
    expect(balance(e, e.treasuryToken)).toBeGreaterThan(0n);

    // ── Conservation: nothing minted, nothing stranded beyond flooring dust ──
    const dust = balance(e, m.vault);
    expect(dust).toBeLessThan(40n);
    // (the edge-tent round trip added two trades' worth of rounding)
    const total = balance(e, e.creator.token) + balance(e, e.lp2.token) + balance(e, e.lp3.token) + balance(e, e.trader.token) + balance(e, e.treasuryToken) + dust;
    expect(total).toBe(40_000_000_000n);

    const lpPnl = (creatorGot + lp2Got + lp3Got) - 10_000_000_000n;
    const pct = (got: bigint, put: bigint) => `${(Number(got - put) / 1e6).toFixed(6)} (${(Number(got - put) / Number(put) * 100).toFixed(3)}%)`;
    console.log(`\nSETTLE PATH  NVDA opened $220.19 → settled $224.60 (bin 33)
  compute units: create ${create.cu} · open ${open.cu} · tent ${tent.cu} · 25-bin band ${band.cu} · 64-bin band on a grown market ${widest.cu} · sell ${sell.cu} · late LP join ${join.cu} · settle ${settle.cu} · redeem ${redeem.cu} · LP claim ${claim.cu}
  depth bought per 2,500: at seeding ${(Number(m0) / 1e18).toFixed(3)} · mid-market ${(Number(m1) / 1e18).toFixed(3)}
  creator (5,000 at seeding)  P&L ${pct(creatorGot, 5_000_000_000n)}
  lp2     (2,500 at seeding)  P&L ${pct(lp2Got, 2_500_000_000n)}
  lp3     (2,500 mid-market)  P&L ${pct(lp3Got, 2_500_000_000n)}
  all LPs P&L ${(Number(lpPnl) / 1e6).toFixed(6)}
  vault dust left: ${dust} base units; total supply conserved\n`);
    for (const cu of [tent.cu, band.cu, sell.cu, join.cu, settle.cu, redeem.cu, claim.cu]) expect(cu).toBeLessThan(200_000);
  });

  it("voids when the settlement price never arrives: the trader gets back what they paid, the LP is made whole", async () => {
    const e = boot();
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const m = market(e, settlesAt);
    await ok(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury);

    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    await ok(e, m.create(5_000_000_000n), e.creator.kp);
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await ok(e, m.open(e.priceAccount(NVDA_UPDATE)), e.trader.kp);

    // Pump one bin hard — the position that a mark-to-last-price refund would overpay.
    await ok(e, m.trade(40, 40, 1, 800_000_000n, BIG), e.trader.kp);
    await ok(e, m.join(e.lp2, 2_500_000_000n, m.curveSeq()), e.lp2.kp);  // liquidity arrives mid-market
    await ok(e, m.trade(28, 34, 4, 60_000_000n, BIG), e.trader.kp);
    const paid = e.trader.start - balance(e, e.trader.token);

    await refused(e, m.voidIt(), e.trader.kp);                         // it can still settle
    warpClockTo(e.ctx, settlesAt + 24n * 3600n - 1n);
    await refused(e, m.voidIt(), e.trader.kp);                         // grace not over
    warpClockTo(e.ctx, settlesAt + 24n * 3600n);
    await ok(e, m.voidIt(), e.trader.kp);
    await refused(e, m.settle(e.priceAccount(updateAt(P0, settlesAt, settlesAt - 1n))), e.trader.kp); // void is final

    await ok(e, m.redeem(40, 40, 1), e.trader.kp);
    await ok(e, m.redeem(28, 34, 4), e.trader.kp);
    expect(balance(e, e.trader.token)).toBe(e.trader.start);           // every unit back, fees included

    await ok(e, m.claimLp(e.lp2), e.lp2.kp);
    await ok(e, m.claimLp(e.creator), e.creator.kp);
    expect(balance(e, e.creator.token)).toBe(e.creator.start);         // both LPs exactly whole,
    expect(balance(e, e.lp2.token)).toBe(e.lp2.start);                 // whenever they joined
    expect(balance(e, m.vault)).toBe(0n);
    console.log(`\nVOID PATH  trader had paid ${(Number(paid) / 1e6).toFixed(6)}; refunded in full. Both LPs made exactly whole. Vault 0.\n`);
  });
});

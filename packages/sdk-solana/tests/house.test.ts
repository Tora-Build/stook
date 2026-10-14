// The house, end to end on LiteSVM against the real program binary.
//
//   round A: two depositors in while idle → the house joins a seeding round →
//            a withdrawal and a deposit queue while it is in → open, trade,
//            settle → collect processes the queue at the price the round left
//   round B: the house rolls into the next round with everything it holds →
//            the round never opens and voids → the house comes back whole
//
// Every number the chain books is checked against the SDK's share math.
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";
import { testSeries, warmCloses } from "./fixtures/series";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");

// Equity.US.NVDA/USD, devnet, read 2026-09-21 (as in ladder-e2e).
const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const T0 = 1_780_598_260n;
const P0 = 22_019_000n;
const updateAt = (price: bigint, publish: bigint, prev: bigint) => {
  const b = Buffer.from(NVDA_UPDATE);
  b.writeBigInt64LE(price, 74); b.writeBigInt64LE(publish, 94); b.writeBigInt64LE(prev, 102);
  return b;
};
const UNIT = 1_000_000n; // one token, 6 decimals

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Buffer) =>
    ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data: new Uint8Array(data) });
  const treasury = Keypair.generate();
  svm.airdrop(treasury.publicKey.toBase58() as any, 10_000_000_000n as any);
  const mint = Keypair.generate().publicKey;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  put(mint, TOKEN_PROGRAM_ID, mintData);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, TOKEN_PROGRAM_ID, d); return key;
  };
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, 100_000n * UNIT) }; };
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };
  return { svm, ctx, treasury, mint, keeper: who(), alice: who(), bob: who(), carol: who(), trader: who(), priceAccount };
}
type Env = ReturnType<typeof boot>;
type Who = Env["alice"];

async function send(e: Env, ixs: TransactionInstruction[], by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  // A fresh blockhash each time, so two identical calls are two transactions.
  e.svm.expireBlockhash();
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, cu: Number(r.meta?.computeUnitsConsumed ?? 0n), logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, [ix], by); expect(r.err, String(r.err) + "\n" + r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, [ix], by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => new Uint8Array((e.svm.getAccount(k.toBase58() as any) as any).data);
const balance = (e: Env, k: PublicKey) => AccountLayout.decode(Buffer.from(raw(e, k))).amount;

describe("house", () => {
  it("rolls from round to round, queueing deposits and withdrawals at the price each round leaves", async () => {
    const e = boot();
    const settlesA = T0 + 3700n;
    const ser = testSeries(NVDA_FEED, e.mint, settlesA, e.treasury.publicKey, PROGRAM);
    const house = L.deriveHouse(ser.series, PROGRAM);
    const hv = L.deriveHouseVault(house, PROGRAM);
    const H: L.HouseRefs = { house, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM };
    const hs = () => L.decodeHouse(raw(e, house));
    const stake = (w: Who) => L.decodeHouseStake(raw(e, L.deriveHouseStake(house, w.kp.publicKey, PROGRAM)));
    const epochOf = (w: Who) => L.epochFor(house, hs(), stake(w), PROGRAM);
    const roundAt = (index: number) => {
      const ladder = L.deriveLadderPda({ series: ser.series, index }, PROGRAM);
      const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM };
      return { ladder, refs, state: () => L.decodeLadder(raw(e, ladder)) };
    };
    const create = (index: number, seed: bigint) => L.createLadderIx({
      series: ser.series, index, quoteMint: e.mint, creator: e.keeper.kp.publicKey, creatorToken: e.keeper.token,
      tokenProgram: TOKEN_PROGRAM_ID, seed, maxGross: seed, programId: PROGRAM,
    });

    await ok(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury);
    await ok(e, ser.createIx(), e.treasury);
    const closes = warmCloses(ser.indexOf, ser.closeOf, T0 - 1000n, P0);
    warpClockTo(e.ctx, closes.at(-1)!.at + 1n);
    for (const c of closes) {
      await ok(e, L.observeSeriesIx(ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(c.price, c.at, c.at - 1n)), c.index, PROGRAM), e.trader.kp);
    }
    warpClockTo(e.ctx, T0 - 60n);
    await ok(e, L.createHouseIx({ payer: e.keeper.kp.publicKey, series: ser.series, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM }), e.keeper.kp);

    // ── Idle: deposits mint at once ─────────────────────────────────────────
    await ok(e, L.houseDepositIx(H, e.alice.kp.publicKey, e.alice.token, 2_000n * UNIT), e.alice.kp);
    await ok(e, L.houseDepositIx(H, e.bob.kp.publicKey, e.bob.token, 1_000n * UNIT), e.bob.kp);
    expect(stake(e.alice).shares).toBe(L.sharesFor(2_000n * UNIT, 0n, 0n));
    expect(stake(e.bob).shares).toBe(L.sharesFor(1_000n * UNIT, 2_000n * UNIT, stake(e.alice).shares));
    expect(hs().assets).toBe(3_000n * UNIT);
    expect(balance(e, hv)).toBe(3_000n * UNIT);
    // and an idle withdrawal pays at once
    const b0 = balance(e, e.bob.token), tenth = stake(e.bob).shares / 10n, h0 = hs();
    await ok(e, L.houseWithdrawIx(H, e.bob.kp.publicKey, e.bob.token, tenth), e.bob.kp);
    expect(balance(e, e.bob.token) - b0).toBe(L.assetsFor(tenth, h0.assets, h0.totalShares));
    expect(100n * UNIT - (balance(e, e.bob.token) - b0)).toBeLessThanOrEqual(1n);
    await refused(e, L.houseWithdrawIx(H, e.bob.kp.publicKey, e.bob.token, stake(e.bob).shares + 1n), e.bob.kp, "HouseNotEnoughShares");

    // ── Round A: the keeper starts it, the house joins while it seeds ───────
    const A = roundAt(ser.index);
    await ok(e, create(ser.index, 1n * UNIT), e.keeper.kp);
    const inA = hs().assets;
    await ok(e, L.houseJoinIx(H, e.keeper.kp.publicKey, A.ladder), e.keeper.kp);
    expect(hs().round!.equals(A.ladder)).toBe(true);
    expect(hs().inRound).toBe(inA);
    expect(hs().assets).toBe(0n);
    expect(A.state().depositTotal).toBe(inA + UNIT);

    // In a round: a deposit and a withdrawal queue; a queued deposit can be taken back.
    await ok(e, L.houseDepositIx(H, e.carol.kp.publicKey, e.carol.token, 500n * UNIT), e.carol.kp);
    expect(stake(e.carol).shares).toBe(0n);
    expect(stake(e.carol).pendingDeposit).toBe(500n * UNIT);
    await ok(e, L.houseDepositIx(H, e.bob.kp.publicKey, e.bob.token, 50n * UNIT), e.bob.kp);
    const b1 = balance(e, e.bob.token);
    await ok(e, L.houseCancelDepositIx(H, e.bob.kp.publicKey, e.bob.token), e.bob.kp);
    expect(balance(e, e.bob.token) - b1).toBe(50n * UNIT);
    const aliceOut = stake(e.alice).shares / 2n;
    await ok(e, L.houseWithdrawIx(H, e.alice.kp.publicKey, e.alice.token, aliceOut), e.alice.kp);
    expect(hs().pendingWithdrawShares).toBe(aliceOut);
    await refused(e, L.houseWithdrawIx(H, e.alice.kp.publicKey, e.alice.token, stake(e.alice).shares - aliceOut + 1n), e.alice.kp, "HouseNotEnoughShares");
    await refused(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp, "LadderNotFinal");

    // ── Open, trade, settle ────────────────────────────────────────────────
    warpClockTo(e.ctx, T0 + 10n);
    await ok(e, L.openLadderIx(A.refs, e.trader.kp.publicKey, e.priceAccount(updateAt(P0, T0, T0 - 1n)), ser.series), e.trader.kp);
    const W = L.binFor(22_460_000n, A.state().p0, A.state().stepBps);
    // The trader wins big on the band the close lands in: the house loses.
    await ok(e, L.tradeLadderIx(A.refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: { lo: W - 2, hi: W + 2, h: 1 }, shares: 400n * UNIT, limit: 10n ** 12n }), e.trader.kp);
    await ok(e, L.tradeLadderIx(A.refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: { lo: 0, hi: 20, h: 1 }, shares: 200n * UNIT, limit: 10n ** 12n }), e.trader.kp);
    warpClockTo(e.ctx, settlesA + 5n);
    await ok(e, L.settleLadderIx(A.refs, ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(22_460_000n, settlesA, settlesA - 1n)), e.trader.token), e.trader.kp);

    // Nobody can claim the house's deposit for it, not even after the grace period.
    warpClockTo(e.ctx, settlesA + 31n * 86_400n);
    await refused(e, L.claimLpIx(A.refs, house, hv, 0, e.trader.kp.publicKey), e.trader.kp, "LadderNotYours");
    warpClockTo(e.ctx, settlesA + 5n);

    // ── Collect: the tranche comes home, the queue is processed ─────────────
    const before = { ...hs() };
    const vaultBefore = balance(e, hv);
    await ok(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp);
    const returned = balance(e, hv) - vaultBefore;
    expect(returned).toBeLessThan(inA);                                     // the trader won
    expect(returned).toBeGreaterThan(0n);
    const ep = L.decodeHouseEpoch(raw(e, L.deriveHouseEpoch(house, 0, PROGRAM)));
    expect(ep.assets).toBe(returned);
    expect(ep.shares).toBe(before.totalShares);
    const paid = L.assetsFor(aliceOut, returned, before.totalShares);
    const after = hs();
    expect(after.round).toBeNull();
    expect(after.epoch).toBe(1);
    expect(after.claimable).toBe(paid);
    expect(after.assets).toBe(returned - paid + 500n * UNIT);
    expect(balance(e, hv)).toBe(after.assets + after.claimable);            // the books are the vault
    await refused(e, L.houseCollectIx(H, e.keeper.kp.publicKey, { ...before, epoch: 1 }), e.keeper.kp, "AnchorError"); // once

    // Alice claims what her queued shares fetched; without the epoch record she cannot.
    await refused(e, L.houseClaimIx(H, e.alice.kp.publicKey, e.alice.token), e.alice.kp, "HouseEpochMissing");
    const a0 = balance(e, e.alice.token);
    await ok(e, L.houseClaimIx(H, e.alice.kp.publicKey, e.alice.token, epochOf(e.alice)), e.alice.kp);
    expect(balance(e, e.alice.token) - a0).toBe(paid);
    expect(stake(e.alice).shares).toBe(L.sharesFor(2_000n * UNIT, 0n, 0n) - aliceOut);
    // Carol's deposit was minted at the same price; her stake is worth what she paid, to the unit.
    await ok(e, L.houseClaimIx(H, e.carol.kp.publicKey, e.carol.token, epochOf(e.carol)), e.carol.kp);
    const carol = L.stakeValue(hs(), stake(e.carol));
    expect(carol.shares).toBe(L.sharesFor(500n * UNIT, returned, before.totalShares));
    expect(500n * UNIT - carol.value).toBeLessThanOrEqual(1n);

    // ── Round B: the house rolls on, the round voids, the house is whole ───
    const iB = ser.index + 20;
    const B = roundAt(iB);
    await ok(e, create(iB, 1n * UNIT), e.keeper.kp);
    const inB = hs().assets;
    await ok(e, L.houseJoinIx(H, e.keeper.kp.publicKey, B.ladder), e.keeper.kp);
    expect(hs().inRound).toBe(inB);
    const C = roundAt(iB + 1);
    await ok(e, create(iB + 1, 1n * UNIT), e.keeper.kp);
    await refused(e, L.houseJoinIx(H, e.keeper.kp.publicKey, C.ladder), e.keeper.kp, "HouseBusy");
    warpClockTo(e.ctx, B.state().locksAt);
    await ok(e, L.voidLadderIx(B.refs, e.trader.kp.publicKey), e.trader.kp);
    const v0 = balance(e, hv);
    await ok(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp);
    expect(balance(e, hv) - v0).toBe(inB);                                  // a void returns the house first, whole
    expect(hs().assets).toBe(inB);
    expect(hs().epoch).toBe(2);

    // Bob leaves while idle and is paid at once; nobody is owed more than the vault holds.
    const bob = L.stakeValue(hs(), stake(e.bob));
    const bb = balance(e, e.bob.token);
    await ok(e, L.houseWithdrawIx(H, e.bob.kp.publicKey, e.bob.token, bob.shares), e.bob.kp);
    expect(balance(e, e.bob.token) - bb).toBe(bob.value);
    expect(balance(e, hv)).toBe(hs().assets + hs().claimable);
  });

  it("joins only an untraded round of its own series", async () => {
    const e = boot();
    const settlesA = T0 + 3700n;
    const ser = testSeries(NVDA_FEED, e.mint, settlesA, e.treasury.publicKey, PROGRAM);
    const house = L.deriveHouse(ser.series, PROGRAM);
    const H: L.HouseRefs = { house, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM };
    await ok(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury);
    await ok(e, ser.createIx(), e.treasury);
    const closes = warmCloses(ser.indexOf, ser.closeOf, T0 - 1000n, P0);
    warpClockTo(e.ctx, closes.at(-1)!.at + 1n);
    for (const c of closes) {
      await ok(e, L.observeSeriesIx(ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(c.price, c.at, c.at - 1n)), c.index, PROGRAM), e.trader.kp);
    }
    warpClockTo(e.ctx, T0 - 60n);
    await ok(e, L.createHouseIx({ payer: e.keeper.kp.publicKey, series: ser.series, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM }), e.keeper.kp);
    const ladder = L.deriveLadderPda({ series: ser.series, index: ser.index }, PROGRAM);
    const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM };
    await ok(e, L.createLadderIx({ series: ser.series, index: ser.index, quoteMint: e.mint, creator: e.keeper.kp.publicKey, creatorToken: e.keeper.token, tokenProgram: TOKEN_PROGRAM_ID, seed: UNIT, maxGross: UNIT, programId: PROGRAM }), e.keeper.kp);
    await refused(e, L.houseJoinIx(H, e.keeper.kp.publicKey, ladder), e.keeper.kp, "HouseTooSmall"); // empty house
    await ok(e, L.houseDepositIx(H, e.alice.kp.publicKey, e.alice.token, 1_000n * UNIT), e.alice.kp);
    warpClockTo(e.ctx, T0 + 10n);
    await ok(e, L.openLadderIx(refs, e.trader.kp.publicKey, e.priceAccount(updateAt(P0, T0, T0 - 1n)), ser.series), e.trader.kp);
    await ok(e, L.tradeLadderIx(refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: { lo: 30, hi: 33, h: 1 }, shares: UNIT / 10n, limit: 10n ** 12n }), e.trader.kp);
    await refused(e, L.houseJoinIx(H, e.keeper.kp.publicKey, ladder), e.keeper.kp, "HouseNotJoinable");
  });
});

describe("house keeper helpers", () => {
  const series = Keypair.generate().publicKey, other = Keypair.generate().publicKey;
  const h = (round: PublicKey | null, assets: bigint) => ({ round, assets, series } as L.HouseAccount);
  it("collects only from a finished round and joins only with a whole token", () => {
    const r = Keypair.generate().publicKey;
    expect(L.houseStep(h(r, 0n), { status: "open" }, 6)).toBeNull();
    expect(L.houseStep(h(r, 0n), { status: "settled" }, 6)).toBe("collect");
    expect(L.houseStep(h(r, 0n), { status: "void" }, 6)).toBe("collect");
    expect(L.houseStep(h(null, 999_999n), null, 6)).toBeNull();
    expect(L.houseStep(h(null, 1_000_000n), null, 6)).toBe("join");
  });
  it("joins the soonest untraded, unlocked round of its own series", () => {
    const round = (s: PublicKey, status: L.LadderStatus, curveSeq: bigint, settlesAt: bigint, locksAt = settlesAt - 100n) =>
      ({ pubkey: Keypair.generate().publicKey, ladder: { series: s, status, curveSeq, settlesAt, locksAt } });
    const later = round(series, "seeding", 0n, 2_000n), sooner = round(series, "open", 0n, 1_500n);
    const traded = round(series, "open", 3n, 1_200n), locked = round(series, "seeding", 0n, 1_100n, 900n), elsewhere = round(other, "seeding", 0n, 1_050n);
    expect(L.houseJoinTarget(h(null, 0n), [later, traded, locked, elsewhere, sooner], 1_000n)).toBe(sooner);
    expect(L.houseJoinTarget(h(null, 0n), [traded, locked, elsewhere], 1_000n)).toBeUndefined();
  });
});

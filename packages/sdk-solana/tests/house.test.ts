// The house, end to end on LiteSVM against the real program binary, on a
// classic SPL coin and on a Token-2022 coin with a transfer fee (the retired
// first $STOOK, 1% on every transfer, byte for byte from mainnet).
//
//   round A: depositors in while idle → the house starts a round in its own
//            vault → an outside LP joins, a trader trades, a deposit and a
//            withdrawal queue → settle → everyone collects → the house is
//            booked home and its queue processed at the price the round left
//   round B: the house rolls on with everything it holds → the round never
//            opens and voids → the house comes back whole
//
// What the shared vault buys: starting and collecting a round move no token,
// so a fee coin loses nothing between rounds. Checked on every step: the
// vault holds at least what the house and every live round's books owe.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";
import { testSeries, warmCloses } from "./fixtures/series";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const FEE_MINT = new Uint8Array(Buffer.from(readFileSync(resolve(__dirname, "fixtures/stook-mint.hex"), "utf8").trim(), "hex"));
// A Token-2022 account for a fee-bearing mint: base, type byte, then the
// TransferFeeAmount extension (type 2, 8 bytes) that holds withheld fees.
const FEE_ACCOUNT_TAIL = Buffer.from([2, 2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

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

function boot(feeCoin: boolean) {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) =>
    ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });
  const tokenProgram = feeCoin ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const treasury = Keypair.generate();
  svm.airdrop(treasury.publicKey.toBase58() as any, 10_000_000_000n as any);
  const mint = Keypair.generate().publicKey;
  if (feeCoin) put(mint, TOKEN_2022_PROGRAM_ID, FEE_MINT);
  else {
    const d = Buffer.alloc(MINT_SIZE);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, d);
    put(mint, TOKEN_PROGRAM_ID, d);
  }
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, tokenProgram, feeCoin ? Buffer.concat([d, FEE_ACCOUNT_TAIL]) : d); return key;
  };
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, 100_000n * UNIT) }; };
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };
  const fee = feeCoin ? L.classifyMint(FEE_MINT, 0n).transferFee : undefined;
  return { svm, ctx, treasury, mint, tokenProgram, fee, keeper: who(), alice: who(), bob: who(), carol: who(), dave: who(), trader: who(), treasuryToken: fund(treasury.publicKey, 0n), priceAccount };
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
const exists = (e: Env, k: PublicKey) => { const a: any = e.svm.getAccount(k.toBase58() as any); return !!a && BigInt(a.lamports ?? 0) > 0n; };
const balance = (e: Env, k: PublicKey) => AccountLayout.decode(Buffer.from(raw(e, k).slice(0, ACCOUNT_SIZE))).amount;
/** What a live round's books still owe out of its vault. */
const owedBy = (l: L.LadderAccount) => (l.status === "void" ? l.voidLpPot + l.voidTraderPot : l.cash + l.lpPool) + l.feesLp + l.feesCreator + l.feesProtocol;

async function setUp(feeCoin: boolean) {
  const e = boot(feeCoin);
  const settlesA = T0 + 3700n;
  const ser = testSeries(NVDA_FEED, e.mint, settlesA, e.treasury.publicKey, PROGRAM);
  const house = L.deriveHouse(ser.series, PROGRAM);
  const hv = L.deriveHouseVault(house, PROGRAM);
  const H = { house, quoteMint: e.mint, tokenProgram: e.tokenProgram, programId: PROGRAM, series: ser.series };
  const hs = () => L.decodeHouse(raw(e, house));
  const stake = (w: Who) => L.decodeHouseStake(raw(e, L.deriveHouseStake(house, w.kp.publicKey, PROGRAM)));
  const epochOf = (w: Who) => { const k = L.deriveHouseStake(house, w.kp.publicKey, PROGRAM); return exists(e, k) ? L.epochFor(house, hs(), stake(w), PROGRAM) : undefined; };
  const gross = (net: bigint) => L.maxGrossFor(net, [e.fee], 0n);
  const deposit = (w: Who, net: bigint) => L.houseDepositIx(H, w.kp.publicKey, w.token, net, epochOf(w), gross(net));
  const roundAt = (index: number) => {
    const ladder = L.deriveLadderPda({ series: ser.series, index }, PROGRAM);
    const state = () => L.decodeLadder(raw(e, ladder));
    return { ladder, state, refs: () => L.ladderRefs(ladder, state(), e.tokenProgram, PROGRAM) };
  };
  await ok(e, L.initializeProtocolIx(e.treasury.publicKey, e.treasury.publicKey, PROGRAM), e.treasury);
  await ok(e, ser.createIx(), e.treasury);
  const closes = warmCloses(ser.indexOf, ser.closeOf, T0 - 1000n, P0);
  warpClockTo(e.ctx, closes.at(-1)!.at + 1n);
  for (const c of closes) await ok(e, L.observeSeriesIx(ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(c.price, c.at, c.at - 1n)), c.index, PROGRAM), e.trader.kp);
  warpClockTo(e.ctx, T0 - 60n);
  // A StonkFun coin's issuer holds powers over holders: the protocol accepts it first, as for any round.
  if (feeCoin) await ok(e, L.approveQuoteMintIx(e.treasury.publicKey, e.mint, PROGRAM), e.treasury);
  await ok(e, L.createHouseIx({ payer: e.keeper.kp.publicKey, series: ser.series, quoteMint: e.mint, tokenProgram: e.tokenProgram, issuerTrusted: feeCoin, programId: PROGRAM }), e.keeper.kp);
  return { e, ser, settlesA, house, hv, H, hs, stake, epochOf, gross, deposit, roundAt };
}

describe.each([["a classic SPL coin", false], ["a coin with a 1% transfer fee", true]])("house on %s", (_name, feeCoin) => {
  it("rolls from round to round in one shared vault, queueing deposits and withdrawals at the price each round leaves", async () => {
    const { e, ser, settlesA, house, hv, H, hs, stake, epochOf, gross, deposit, roundAt } = await setUp(feeCoin);
    const net = (v: bigint) => L.netOf(v, e.fee);
    // The vault always holds what the house and every live round owe.
    const solvent = (...live: L.LadderAccount[]) => {
      const h = hs();
      const owed = h.assets + h.pendingDeposits + h.claimable + live.reduce((a, l) => a + owedBy(l), 0n);
      expect(balance(e, hv) >= owed, `vault ${balance(e, hv)} < owed ${owed}`).toBe(true);
    };

    // ── Idle: deposits mint at once, credited by what arrived ───────────────
    await ok(e, deposit(e.alice, 2_000n * UNIT), e.alice.kp);
    await ok(e, deposit(e.bob, 1_000n * UNIT), e.bob.kp);
    expect(hs().assets).toBe(3_000n * UNIT);
    expect(balance(e, e.alice.token)).toBe(100_000n * UNIT - gross(2_000n * UNIT));   // the wallet paid any fee on top
    expect(stake(e.alice).shares).toBe(L.sharesFor(2_000n * UNIT, 0n, 0n));
    solvent();

    // ── Round A: the house starts it, in its own vault; no token moves ──────
    const A = roundAt(ser.index);
    const v0 = balance(e, hv);
    await ok(e, L.houseStartIx(H, e.keeper.kp.publicKey, ser.index), e.keeper.kp);
    expect(balance(e, hv)).toBe(v0);
    const inA = hs().inRound;
    expect(inA).toBe(3_000n * UNIT);
    expect(A.state().sharedVault).toBe(true);
    expect(A.state().vault.equals(hv)).toBe(true);
    expect(A.state().depositTotal).toBe(inA);
    // The day is the house's: nobody can start it again, by either door.
    await refused(e, L.createLadderIx({ series: ser.series, index: ser.index, quoteMint: e.mint, creator: e.trader.kp.publicKey, creatorToken: e.trader.token, tokenProgram: e.tokenProgram, seed: UNIT, maxGross: gross(UNIT), programId: PROGRAM }), e.trader.kp, "already in use");
    await refused(e, L.houseStartIx(H, e.keeper.kp.publicKey, ser.index + 1), e.keeper.kp, "HouseBusy");
    // An outside LP joins the house's round the usual way; the money lands in the shared vault.
    await ok(e, L.joinLadderIx(A.refs(), { lp: e.carol.kp.publicKey, lpToken: e.carol.token, index: 0, deposit: 500n * UNIT, expectedSeq: 0n, maxGross: gross(500n * UNIT) }), e.carol.kp);
    expect(balance(e, hv) - v0).toBe(500n * UNIT);
    solvent(A.state());

    // Queued: Dave's deposit, Bob's deposit taken back, half of Alice's shares out.
    await ok(e, deposit(e.dave, 400n * UNIT), e.dave.kp);
    expect(stake(e.dave).pendingDeposit).toBe(400n * UNIT);
    await ok(e, deposit(e.bob, 50n * UNIT), e.bob.kp);
    const b1 = balance(e, e.bob.token);
    await ok(e, L.houseCancelDepositIx(H, e.bob.kp.publicKey, e.bob.token), e.bob.kp);
    expect(balance(e, e.bob.token) - b1).toBe(net(50n * UNIT));
    const aliceOut = stake(e.alice).shares / 2n;
    await ok(e, L.houseWithdrawIx(H, e.alice.kp.publicKey, e.alice.token, aliceOut), e.alice.kp);
    await refused(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp, "LadderNotFinal");

    // ── Open, trade, settle, everyone collects ──────────────────────────────
    warpClockTo(e.ctx, T0 + 10n);
    await ok(e, L.openLadderIx(A.refs(), e.trader.kp.publicKey, e.priceAccount(updateAt(P0, T0, T0 - 1n)), ser.series), e.trader.kp);
    const W = L.binFor(22_460_000n, A.state().p0, A.state().stepBps);
    const win = { lo: W - 2, hi: W + 2, h: 1 }, miss = { lo: 0, hi: 20, h: 1 };
    await ok(e, L.tradeLadderIx(A.refs(), { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: win, shares: 300n * UNIT, limit: 10n ** 12n }), e.trader.kp);
    await ok(e, L.tradeLadderIx(A.refs(), { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: miss, shares: 200n * UNIT, limit: 10n ** 12n }), e.trader.kp);
    solvent(A.state());
    warpClockTo(e.ctx, settlesA + 5n);
    await ok(e, L.settleLadderIx(A.refs(), ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(22_460_000n, settlesA, settlesA - 1n)), e.trader.token), e.trader.kp);
    solvent(A.state());
    const t0 = balance(e, e.trader.token);
    await ok(e, L.redeemLadderIx(A.refs(), e.trader.kp.publicKey, e.trader.token, win), e.trader.kp);
    expect(balance(e, e.trader.token) > t0).toBe(true);                         // the winner is paid out of the shared vault
    await ok(e, L.redeemLadderIx(A.refs(), e.trader.kp.publicKey, e.trader.token, miss), e.trader.kp);
    await ok(e, L.claimLpIx(A.refs(), e.carol.kp.publicKey, e.carol.token), e.carol.kp);
    await ok(e, L.collectLadderFeesIx(A.refs(), e.trader.kp.publicKey, e.keeper.token, e.treasuryToken), e.trader.kp);
    // Nobody can claim the house's deposit for it, not even after the grace period.
    warpClockTo(e.ctx, settlesA + 31n * 86_400n);
    await refused(e, L.claimLpIx(A.refs(), house, hv, 0, e.trader.kp.publicKey), e.trader.kp, "LadderNotYours");
    warpClockTo(e.ctx, settlesA + 5n);
    solvent(A.state());

    // ── Collect: booked home, no token moves; the queue is processed ────────
    const before = hs(), vBefore = balance(e, hv);
    const fin = A.state(), t = L.decodeLadderTranche(raw(e, L.deriveLadderTranche(A.ladder, house, 0, PROGRAM))), k = fin.settledBin!;
    const terms = L.trancheTerms(fin, t);
    const owed = L.tranchePrincipal(t.deposit, L.tranchePnl(terms.b, terms.join.w[k]!, terms.join.sum, fin.curve.w[k]!, fin.curve.sum), 6) + L.trancheFees(terms.b, 6, fin.accFee, t.feeSnap);
    await ok(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp);
    expect(balance(e, hv)).toBe(vBefore);
    const ep = L.decodeHouseEpoch(raw(e, L.deriveHouseEpoch(house, 0, PROGRAM)));
    expect(ep.assets).toBe(owed);
    expect(ep.shares).toBe(before.totalShares);
    const paid = L.assetsFor(aliceOut, owed, before.totalShares);
    const after = hs();
    expect(after.round).toBeNull();
    expect(after.claimable).toBe(paid);
    expect(after.assets).toBe(owed - paid + 400n * UNIT);
    solvent();
    // The finished round closes; the shared vault stays.
    await ok(e, L.closeLadderIx(A.refs(), e.trader.kp.publicKey, e.keeper.kp.publicKey, e.treasuryToken), e.trader.kp);
    expect(exists(e, A.ladder)).toBe(false);
    expect(exists(e, hv)).toBe(true);
    solvent();

    // Alice claims what her queued shares fetched; without the epoch record she cannot.
    await refused(e, L.houseClaimIx(H, e.alice.kp.publicKey, e.alice.token), e.alice.kp, "HouseEpochMissing");
    const a0 = balance(e, e.alice.token);
    await ok(e, L.houseClaimIx(H, e.alice.kp.publicKey, e.alice.token, epochOf(e.alice)), e.alice.kp);
    expect(balance(e, e.alice.token) - a0).toBe(net(paid));
    // Dave's deposit was minted at the same price: worth what he put in, to the unit.
    await ok(e, L.houseClaimIx(H, e.dave.kp.publicKey, e.dave.token, epochOf(e.dave)), e.dave.kp);
    const dave = L.stakeValue(hs(), stake(e.dave));
    expect(400n * UNIT - dave.value).toBeLessThanOrEqual(1n);
    solvent();

    // ── Round B: the house rolls on with all it holds; it voids; whole ──────
    const iB = ser.index + 20;
    const B = roundAt(iB);
    const inB = hs().assets, vB = balance(e, hv);
    await ok(e, L.houseStartIx(H, e.keeper.kp.publicKey, iB), e.keeper.kp);
    expect(hs().inRound).toBe(inB);
    expect(balance(e, hv)).toBe(vB);
    warpClockTo(e.ctx, B.state().locksAt);
    await ok(e, L.voidLadderIx(B.refs(), e.trader.kp.publicKey), e.trader.kp);
    await ok(e, L.houseCollectIx(H, e.keeper.kp.publicKey, hs()), e.keeper.kp);
    expect(hs().assets).toBe(inB);                                              // a void returns the house first, whole
    expect(balance(e, hv)).toBe(vB);
    solvent();

    // Bob leaves while idle, paid at once; the vault still covers everyone.
    const bob = L.stakeValue(hs(), stake(e.bob));
    await ok(e, L.houseWithdrawIx(H, e.bob.kp.publicKey, e.bob.token, bob.shares), e.bob.kp);
    solvent();
  });
});

describe("house keeper helpers", () => {
  const series = Keypair.generate().publicKey;
  const h = (round: PublicKey | null, assets: bigint) => ({ round, assets, series } as L.HouseAccount);
  it("collects only from a finished round and starts only with a whole token", () => {
    const r = Keypair.generate().publicKey;
    expect(L.houseStep(h(r, 0n), { status: "open" }, 6)).toBeNull();
    expect(L.houseStep(h(r, 0n), { status: "settled" }, 6)).toBe("collect");
    expect(L.houseStep(h(r, 0n), { status: "void" }, 6)).toBe("collect");
    expect(L.houseStep(h(null, 999_999n), null, 6)).toBeNull();
    expect(L.houseStep(h(null, 1_000_000n), null, 6)).toBe("start");
  });
  it("starts the first round that closes far enough ahead, skipping days with no round", () => {
    // A New York weekday series closing at 16:00: on a Friday after the bell, the next round is Monday's.
    const s = { periodSecs: 0, closeSecs: 16 * 3600, clock: L.CLOCK_NEW_YORK_WEEKDAYS };
    const fri = BigInt(Date.UTC(2026, 9, 16, 20, 30) / 1000);                    // Fri Oct 16, 4:30 PM New York
    expect(new Date(Number(L.closeOf(s, L.houseStartIndex(s, fri))) * 1000).toISOString()).toBe("2026-10-19T20:00:00.000Z");
    const late = BigInt(Date.UTC(2026, 9, 19, 19, 50) / 1000);                   // Mon 3:50 PM: too close to Monday's bell
    expect(new Date(Number(L.closeOf(s, L.houseStartIndex(s, late))) * 1000).toISOString()).toBe("2026-10-20T20:00:00.000Z");
  });
});

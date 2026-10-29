// A pool-fed anchor, end to end on LiteSVM against the real program binary:
// Polymarket's PreStocks token, which Pyth does not carry, priced from its
// Raydium CLMM pool's own history (program: `pool_oracle`).
//
// The pool and its observation account are mainnet's, byte for byte
// (tests-fixtures/polymarket-*.bin), with the observation entries rewritten
// on a timeline this test controls: the price sits at tick -19,500 ($142.29)
// and climbs to -19,400 ($143.72) on the round's last day.
//
//   a daily series on the pool starts warm (seeded: a pool keeps a day of
//   history, so warm-up cannot come from it), and a house's round
//   opens at the bell on the pool's ten-minute average, takes a call, and
//   settles on the average to the next bell, once the pool has an entry
//   after it; the SDK's arithmetic agrees with the program's.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const FIX = resolve(__dirname, "../../programs-core/programs/sooth-core/tests-fixtures");
const POOL = new PublicKey("5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs");
const OBS = new PublicKey("AcPAWXqHfqLDujqkG6BNEFJPijHxMHxdz5tz4KcR4t7z");
const POOL_BYTES = new Uint8Array(readFileSync(resolve(FIX, "polymarket-pool.bin")));
const OBS_BYTES = new Uint8Array(readFileSync(resolve(FIX, "polymarket-observation.bin")));
const UNIT = 1_000_000n;
const H = 3600, M = 60;

// 4 PM New York (EDT) on Mon 26, Tue 27 and Wed 28 October 2026.
const BELL26 = Date.UTC(2026, 9, 26, 20) / 1000, BELL27 = BELL26 + 86_400, BELL28 = BELL27 + 86_400;

/** The observation account with `entries` as (time, tick since the entry before). */
function observations(entries: [number, number][]): Uint8Array {
  const d = new Uint8Array(OBS_BYTES), v = new DataView(d.buffer);
  for (let i = 0; i < 100; i++) { v.setUint32(51 + i * 44, 0, true); v.setBigInt64(55 + i * 44, 0n, true); }
  let cum = 0n, last = entries[0]![0];
  entries.forEach(([at, tick], i) => {
    cum += BigInt(tick) * BigInt(at - last); last = at;
    v.setUint32(51 + i * 44, at, true); v.setBigInt64(55 + i * 44, cum, true);
  });
  return d;
}
// Entries every quarter hour around each bell, at tick -19,500, except the
// 28th's last hour at -19,400; `after28` the first entry after that bell.
const timeline = (after28: boolean): [number, number][] => [
  [BELL26 - H, 0], [BELL26 - 15 * M, -19_500], [BELL26 + 2 * M, -19_500],
  [BELL27 - H, -19_500], [BELL27 - 15 * M, -19_500], [BELL27 + 1 * M, -19_500],
  [BELL28 - H, -19_500], [BELL28 - 15 * M, -19_400], ...(after28 ? [[BELL28 + 2 * M, -19_400] as [number, number]] : []),
];

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) => ctx.setAccount(key, { executable: false, owner, lamports: 100_000_000n, data });
  put(POOL, L.RAYDIUM_CLMM, POOL_BYTES);
  const setTimeline = (after28: boolean) => put(OBS, L.RAYDIUM_CLMM, observations(timeline(after28)));
  setTimeline(false);
  const authority = Keypair.generate();
  svm.airdrop(authority.publicKey.toBase58() as any, 10_000_000_000n as any);
  const mint = Keypair.generate().publicKey, d = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, d);
  put(mint, TOKEN_PROGRAM_ID, d);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey, b = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, b);
    put(key, TOKEN_PROGRAM_ID, b); return key;
  };
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, 100_000n * UNIT) }; };
  return { svm, ctx, authority, mint, fund, who, setTimeline, treasuryToken: fund(authority.publicKey, 0n) };
}
type Env = ReturnType<typeof boot>;

async function send(e: Env, ix: TransactionInstruction, by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
  e.svm.expireBlockhash();
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n"), cu: Number(r.meta?.computeUnitsConsumed ?? 0n) };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, ix, by); expect(r.err, String(r.err) + "\n" + r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, ix, by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => new Uint8Array((e.svm.getAccount(k.toBase58() as any) as any).data);
const obs = (ix: TransactionInstruction) => L.withObservation(ix, OBS);

describe("a pool-fed anchor (Polymarket PreStocks on Raydium)", () => {
  it("learns a close, is seeded, opens a house round at the bell and settles it on the pool's average", async () => {
    const e = boot();
    const feedId = POOL.toBytes();
    const series = L.deriveSeries(feedId, e.mint, 0, PROGRAM);
    const s = () => L.decodeSeries(raw(e, series));
    warpClockTo(e.ctx, BigInt(BELL26 - 2 * H));
    await ok(e, L.initializeProtocolIx(e.authority.publicKey, e.authority.publicKey, PROGRAM), e.authority);
    await ok(e, L.createSeriesIx({ authority: e.authority.publicKey, feedId, quoteMint: e.mint, periodSecs: 0, closeSecs: 16 * 3600, clock: L.CLOCK_NEW_YORK, programId: PROGRAM }), e.authority);
    const day26 = L.indexAtOrBefore(s(), BigInt(BELL26));
    expect(L.closeOf(s(), day26)).toBe(BigInt(BELL26));

    // A pool keeps a day of history: the series starts warm from the latest
    // close, the 26th's, at the pool's average of the ten minutes to it, with
    // a variance the authority measured (3% a day). Only the authority, once,
    // and only on the pool the series names.
    warpClockTo(e.ctx, BigInt(BELL26 + 3 * M));
    const anyone = e.who();
    const seed = (by: Keypair, pool = POOL) => L.seriesSeedIx(by.publicKey, series, pool, OBS, 9n * 10n ** 14n, PROGRAM);
    await refused(e, L.observeSeriesIx(series, anyone.kp.publicKey, POOL, day26, PROGRAM), anyone.kp, "SeriesOutOfOrder");   // not twenty closes back
    await refused(e, seed(anyone.kp), anyone.kp, "Unauthorized");
    await refused(e, seed(e.authority, OBS), e.authority, "SeriesNotSeedable");
    await ok(e, seed(e.authority), e.authority);
    const expect26 = L.poolPriceAt(L.decodePool(POOL_BYTES), L.decodeObservations(raw(e, OBS)), BELL26)!;
    expect(L.warmedUp(s())).toBe(true);
    expect(s().varWad).toBe(9n * 10n ** 14n);
    expect(s().lastAt).toBe(BigInt(BELL26));
    expect(Number(s().lastPrice - expect26.price)).toBeLessThanOrEqual(1);
    expect(s().lastPrice).toBeGreaterThan(142_20000000n);
    expect(s().lastPrice).toBeLessThan(142_40000000n);
    expect(s().lastExpo).toBe(-8);
    await refused(e, seed(e.authority), e.authority, "SeriesNotSeedable");          // once

    // The house funds the round of the 28th, which opens at the 27th's bell.
    const keeper = e.who(), lp = e.who(), trader = e.who();
    await ok(e, L.createHouseIx({ payer: keeper.kp.publicKey, series, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM }), keeper.kp);
    const house = L.deriveHouse(series, PROGRAM);
    const HR = { house, quoteMint: e.mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM, series };
    await ok(e, L.houseDepositIx(HR, lp.kp.publicKey, lp.token, 5_000n * UNIT), lp.kp);
    const day28 = day26 + 2;
    warpClockTo(e.ctx, BigInt(BELL27 - 30 * M));
    await ok(e, L.houseStartIx(HR, keeper.kp.publicKey, day28), keeper.kp);
    const ladder = L.deriveLadderPda({ series, index: day28 }, PROGRAM);
    const l = () => L.decodeLadder(raw(e, ladder));
    const refs = () => L.ladderRefs(ladder, l(), TOKEN_PROGRAM_ID, PROGRAM);
    expect(l().opensAt).toBe(BigInt(BELL27));
    expect(l().settlesAt).toBe(BigInt(BELL28));

    // A pool without its observation account is refused; so is another account as it.
    warpClockTo(e.ctx, BigInt(BELL27 + 2 * M));
    await refused(e, L.openLadderIx(refs(), anyone.kp.publicKey, POOL, series), anyone.kp, "OracleAccountMalformed");
    await refused(e, L.withObservation(L.openLadderIx(refs(), anyone.kp.publicKey, POOL, series), e.mint), anyone.kp, "OracleWrongOwner");
    const opened = await ok(e, obs(L.openLadderIx(refs(), anyone.kp.publicKey, POOL, series)), anyone.kp);
    const at27 = L.poolPriceAt(L.decodePool(POOL_BYTES), L.decodeObservations(raw(e, OBS)), BELL27)!;
    expect(l().status).toBe("open");
    expect(Number(l().p0 - at27.price)).toBeLessThanOrEqual(1);
    expect(l().p0Expo).toBe(-8);
    expect(s().lastAt).toBe(BigInt(BELL27));                                      // opening at the bell taught the series that close

    // A call on the floors around $143.72.
    const target = L.binFor(143_72000000n, l().p0, l().stepBps);
    const shape = { lo: target - 2, hi: target + 2, h: 1 };
    await ok(e, L.tradeLadderIx(refs(), { user: trader.kp.publicKey, userToken: trader.token, shape, shares: 200n * UNIT, limit: 10n ** 12n }), trader.kp);

    // The bell of the 28th: no entry after it yet, so no price for it. The
    // pool's current tick is never read, so a swap in the settling
    // transaction could not stand in for one.
    warpClockTo(e.ctx, BigInt(BELL28 + 1 * M));
    await refused(e, obs(L.settleLadderIx(refs(), series, anyone.kp.publicKey, POOL, anyone.token)), anyone.kp, "OracleNotTheSettlementInstant");
    e.setTimeline(true);
    warpClockTo(e.ctx, BigInt(BELL28 + 3 * M));
    const settled = await ok(e, obs(L.settleLadderIx(refs(), series, anyone.kp.publicKey, POOL, anyone.token)), anyone.kp);
    const at28 = L.poolPriceAt(L.decodePool(POOL_BYTES), L.decodeObservations(raw(e, OBS)), BELL28)!;
    expect(at28.tick).toBe(-19_400);
    expect(l().status).toBe("settled");
    expect(l().settledBin).toBe(L.binFor(at28.price, l().p0, l().stepBps));
    expect(l().settledBin).toBeGreaterThanOrEqual(shape.lo);
    expect(l().settledBin).toBeLessThanOrEqual(shape.hi);
    expect(s().lastAt).toBe(BigInt(BELL28));

    const before = AccountLayout.decode(Buffer.from(raw(e, trader.token).slice(0, ACCOUNT_SIZE))).amount;
    await ok(e, L.redeemLadderIx(refs(), trader.kp.publicKey, trader.token, shape), trader.kp);
    expect(AccountLayout.decode(Buffer.from(raw(e, trader.token).slice(0, ACCOUNT_SIZE))).amount > before).toBe(true);
    // Nobody queued in or out during the round: no epoch record, no rent spent on one.
    const lamportsBefore = BigInt((e.svm.getAccount(keeper.kp.publicKey.toBase58() as any) as any).lamports);
    await ok(e, L.houseCollectIx(HR, keeper.kp.publicKey, L.decodeHouse(raw(e, house))), keeper.kp);
    expect(L.decodeHouse(raw(e, house)).epoch).toBe(1);
    const rec: any = e.svm.getAccount(L.deriveHouseEpoch(house, 0, PROGRAM).toBase58() as any);
    expect(!rec || rec.exists === false || BigInt(rec.lamports ?? 0) === 0n).toBe(true);
    const lamportsAfter = BigInt((e.svm.getAccount(keeper.kp.publicKey.toBase58() as any) as any).lamports);
    expect(lamportsAfter).toBeGreaterThan(lamportsBefore);                     // the tranche's rent came back; nothing was spent on a record
    console.log(`\n  pool-fed round: opened at ${Number(l().p0) / 1e8}, settled on floor ${l().settledBin} at ${Number(at28.price) / 1e8}; open ${opened.cu} CU, settle ${settled.cu} CU\n`);
  });
});

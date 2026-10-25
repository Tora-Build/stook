// Listing a coin, on LiteSVM against the real program binary: the protocol
// lists an anchor and sets the fee; anyone lists a coin with a seed of 0.5%
// to 5% of its supply, which becomes the coin's house, locked a week; the
// coin's series goes live a day later, unless the protocol turns it down,
// which frees the seed at once.
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const ZEC = Uint8Array.from(Buffer.from("be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", "hex"));
const SOL = Uint8Array.from(Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex"));
const UNIT = 1_000_000n;
const SUPPLY = 1_000_000_000n * UNIT; // a billion coins
const FEE = 500_000_000n; // half a SOL
const T0 = 1_790_000_000n;

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) => ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });
  const authority = Keypair.generate();
  svm.airdrop(authority.publicKey.toBase58() as any, 10_000_000_000n as any);
  const treasury = Keypair.generate().publicKey;
  svm.airdrop(treasury.toBase58() as any, 1_000_000_000n as any);
  const coin = () => {
    const mint = Keypair.generate().publicKey; const d = Buffer.alloc(MINT_SIZE);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: SUPPLY, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, d);
    put(mint, TOKEN_PROGRAM_ID, d); return mint;
  };
  const fund = (mint: PublicKey, owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, TOKEN_PROGRAM_ID, d); return key;
  };
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return kp; };
  return { svm, ctx, authority, treasury, coin, fund, who };
}
type Env = ReturnType<typeof boot>;

async function send(e: Env, ix: TransactionInstruction, by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
  e.svm.expireBlockhash();
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, ix, by); expect(r.err, String(r.err) + "\n" + r.logs).toBeNull(); };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, ix, by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => new Uint8Array((e.svm.getAccount(k.toBase58() as any) as any).data);
const lamports = (e: Env, k: PublicKey) => BigInt((e.svm.getAccount(k.toBase58() as any) as any)?.lamports ?? 0);
const balance = (e: Env, k: PublicKey) => AccountLayout.decode(Buffer.from(raw(e, k).slice(0, ACCOUNT_SIZE))).amount;

async function protocol() {
  const e = boot();
  warpClockTo(e.ctx, T0);
  await ok(e, L.initializeProtocolIx(e.authority.publicKey, e.treasury, PROGRAM), e.authority);
  await ok(e, L.listFeeSetIx(e.authority.publicKey, FEE, PROGRAM), e.authority);
  await ok(e, L.listAnchorSetIx({ authority: e.authority.publicKey, feedId: ZEC, clock: L.CLOCK_NEW_YORK, closeSecs: 16 * 3600, active: true, programId: PROGRAM }), e.authority);
  await ok(e, L.listAnchorSetIx({ authority: e.authority.publicKey, feedId: SOL, clock: L.CLOCK_UTC, closeSecs: 0, active: false, programId: PROGRAM }), e.authority);
  return e;
}

/** A lister holding 60 million of a fresh coin, and how to list it. */
function lister(e: Env) {
  const mint = e.coin(), kp = e.who(), token = e.fund(mint, kp.publicKey, 60_000_000n * UNIT);
  const series = L.deriveSeries(ZEC, mint, 0, PROGRAM);
  const house = L.deriveHouse(series, PROGRAM);
  const refs = { house, quoteMint: mint, tokenProgram: TOKEN_PROGRAM_ID, programId: PROGRAM, series };
  const list = (seed: bigint, feedId = ZEC) => L.coinListIx({ lister: kp.publicKey, listerToken: token, feedId, quoteMint: mint, tokenProgram: TOKEN_PROGRAM_ID, treasury: e.treasury, seed, programId: PROGRAM });
  const withdraw = (shares: bigint) => L.houseWithdrawIx(refs, kp.publicKey, token, shares);
  const h = () => L.decodeHouse(raw(e, house));
  const s = () => L.decodeSeries(raw(e, series));
  const stake = () => L.decodeHouseStake(raw(e, L.deriveHouseStake(house, kp.publicKey, PROGRAM)));
  return { mint, kp, token, series, house, refs, list, withdraw, h, s, stake };
}

describe("listing a coin", () => {
  it("makes the coin's series and house, locks the seed a week, and goes live a day later", async () => {
    const e = await protocol();
    const c = lister(e);
    const [min, max] = L.seedBounds(SUPPLY);
    expect([min, max]).toEqual([5_000_000n * UNIT, 50_000_000n * UNIT]);

    await refused(e, c.list(min - 1n), c.kp, "ListSeedTooSmall");
    await refused(e, c.list(max + 1n), c.kp, "ListSeedTooLarge");
    await refused(e, c.list(min, SOL), c.kp, "ListAnchorInactive");

    const treasuryBefore = lamports(e, e.treasury);
    await ok(e, c.list(min), c.kp);
    expect(lamports(e, e.treasury) - treasuryBefore).toBe(FEE);
    expect(balance(e, c.token)).toBe(60_000_000n * UNIT - min);
    expect(balance(e, L.deriveHouseVault(c.house, PROGRAM))).toBe(min);

    const s = c.s();
    expect(s.active).toBe(false);
    expect([s.clock, s.closeSecs, s.periodSecs]).toEqual([L.CLOCK_NEW_YORK, 16 * 3600, 0]);
    expect(c.h().assets).toBe(min);
    expect(c.h().opensAfter).toBe(T0 + L.LIST_DELAY_SECS);
    expect(c.stake().shares).toBe(c.h().totalShares);
    expect(c.stake().lockedUntil).toBe(T0 + L.LIST_LOCK_SECS);
    expect(L.listingState(c.h(), s)).toBe("pending");

    // One listing per coin and anchor.
    await refused(e, c.list(min), c.kp, "already in use");
    // The seed stays; the series takes no round yet.
    await refused(e, c.withdraw(1n), c.kp, "HouseStakeLocked");
    await refused(e, L.houseStartIx(c.refs, c.kp.publicKey, 20_400), c.kp, "SeriesInactive");
    await refused(e, L.coinActivateIx(c.series, PROGRAM), c.kp, "ListNotYet");

    warpClockTo(e.ctx, T0 + L.LIST_DELAY_SECS);
    const anyone = e.who();
    await ok(e, L.coinActivateIx(c.series, PROGRAM), anyone);
    expect(c.s().active).toBe(true);
    expect(c.h().opensAfter).toBe(0n);
    expect(L.listingState(c.h(), c.s())).toBe("live");
    await refused(e, L.coinActivateIx(c.series, PROGRAM), anyone, "ListNotPending");
    await refused(e, L.coinRejectIx(e.authority.publicKey, c.house, PROGRAM), e.authority, "ListNotPending");

    // Live, and still locked until the week is out.
    await refused(e, c.withdraw(1n), c.kp, "HouseStakeLocked");
    warpClockTo(e.ctx, T0 + L.LIST_LOCK_SECS);
    const shares = c.stake().shares;
    await ok(e, c.withdraw(shares), c.kp);
    expect(balance(e, c.token)).toBe(60_000_000n * UNIT);
  });

  it("a listing the protocol turns down never goes live, and its seed comes back at once", async () => {
    const e = await protocol();
    const c = lister(e);
    const [min] = L.seedBounds(SUPPLY);
    await ok(e, c.list(min), c.kp);
    await refused(e, L.coinRejectIx(c.kp.publicKey, c.house, PROGRAM), c.kp, "Unauthorized");
    await ok(e, L.coinRejectIx(e.authority.publicKey, c.house, PROGRAM), e.authority);
    expect(L.listingState(c.h(), c.s())).toBe("rejected");
    await ok(e, c.withdraw(c.stake().shares), c.kp);
    expect(balance(e, c.token)).toBe(60_000_000n * UNIT);
    warpClockTo(e.ctx, T0 + L.LIST_DELAY_SECS);
    await refused(e, L.coinActivateIx(c.series, PROGRAM), c.kp, "ListRejected");
    expect(c.s().active).toBe(false);
  });
});

// A ladder quoted in a REAL xStock, end to end on LiteSVM.
//
// The mint is NVDAx (`Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`), byte for
// byte as read from mainnet on 2026-09-22: Token-2022, 8 decimals, and eight
// extensions — PermanentDelegate, Pausable, a TransferHook naming no program,
// DefaultAccountState, ConfidentialTransferMint, ScaledUiAmount, metadata. An
// invented "Token-2022 mint with no extensions" would have passed long before
// this did, and proved nothing about the asset the protocol is for.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";
import * as L from "../src/ladder/index";
import { testSeries, warmCloses } from "./fixtures/series";

const PROGRAM = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");
const NVDAX = new Uint8Array(Buffer.from(readFileSync(resolve(__dirname, "fixtures/nvdax-mint.hex"), "utf8").trim(), "hex"));

const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const PUBLISH_TIME = 1_780_598_260n;
const updateAt = (price: bigint, publish: bigint, prev: bigint) => {
  const b = Buffer.from(NVDA_UPDATE); b.writeBigInt64LE(price, 74); b.writeBigInt64LE(publish, 94); b.writeBigInt64LE(prev, 102); return b;
};

const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

const TOKENS = 100_000_000n; // 8 decimals

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) =>
    ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });

  const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const admin = Keypair.generate();
  svm.airdrop(admin.publicKey.toBase58() as any, 10_000_000_000n as any);
  // ProtocolConfig: authority, pending_authority, treasury, paused, bump, reserved
  put(config, PROGRAM, Buffer.concat([
    disc("ProtocolConfig"), admin.publicKey.toBuffer(), Buffer.alloc(32), admin.publicKey.toBuffer(),
    Buffer.from([0, bump]), Buffer.alloc(30),
  ]));

  const mint = Keypair.generate().publicKey;
  put(mint, TOKEN_2022_PROGRAM_ID, NVDAX);

  // A holder's account as Token-2022 would have made it for this mint: the
  // base 165 bytes, the account-type byte, then the two account extensions the
  // mint requires — TransferHookAccount (15) and PausableAccount (27).
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const base = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, base);
    put(key, TOKEN_2022_PROGRAM_ID, Buffer.concat([base, Buffer.from([2, 15, 0, 1, 0, 0, 27, 0, 0, 0])]));
    return key;
  };
  const START = 10_000n * TOKENS;
  const who = () => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n as any); return { kp, token: fund(kp.publicKey, START), start: START }; };
  const creator = who(), lp = who(), trader = who();
  const treasuryToken = fund(admin.publicKey, 0n);
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };
  return { svm, ctx, admin, mint, creator, lp, trader, treasuryToken, priceAccount };
}
type Env = ReturnType<typeof boot>;

async function send(e: Env, ix: TransactionInstruction, by: Keypair) {
  const tx = new Transaction().add(ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
  tx.recentBlockhash = e.svm.latestBlockhash() as any; tx.feePayer = by.publicKey; tx.sign(by);
  const r = await e.ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, cu: Number(r.meta?.computeUnitsConsumed ?? 0n), logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, ix, by); expect(r.err, r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, ix, by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => e.svm.getAccount(k.toBase58() as any) as any;
const balance = (e: Env, k: PublicKey) => AccountLayout.decode(Buffer.from(raw(e, k).data).subarray(0, ACCOUNT_SIZE)).amount;

describe("a ladder quoted in a real xStock", () => {
  it("is refused until the protocol authority accepts the issuer, then runs to an empty vault", async () => {
    const e = boot();
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const ser = testSeries(NVDA_FEED, e.mint, settlesAt, e.admin.publicKey, PROGRAM);
    const key = { series: ser.series, index: ser.index, quoteMint: e.mint };
    const ladder = L.deriveLadderPda(key, PROGRAM);
    const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_2022_PROGRAM_ID, programId: PROGRAM };
    const vault = L.deriveLadderVault(ladder, PROGRAM);
    const state = () => L.decodeLadder(new Uint8Array(raw(e, ladder).data));
    const create = (issuerTrusted: boolean) => L.createLadderIx({
      ...key, creator: e.creator.kp.publicKey, creatorToken: e.creator.token, tokenProgram: TOKEN_2022_PROGRAM_ID,
      seed: 500n * TOKENS, issuerTrusted, programId: PROGRAM,
    });

    // ── what the SDK tells a creator before they try ────────────────────────
    const report = L.classifyMint(NVDAX);
    expect(report.verdict).toBe("issuer-trusted");
    expect(report.decimals).toBe(8);
    expect(report.reasons.map((r) => r.split(":")[0])).toEqual(["PermanentDelegate", "Pausable", "TransferHook"]);

    // ── the trust decision is the authority's, and nobody else's ────────────
    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    await ok(e, ser.createIx(), e.admin);
    for (const c of warmCloses(ser.indexOf, ser.closeOf, PUBLISH_TIME - 1000n, 22_019_000n)) {
      warpClockTo(e.ctx, c.at + 1n);
      await ok(e, L.observeSeriesIx(ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(c.price, c.at, c.at - 1n)), c.index, PROGRAM), e.trader.kp);
    }
    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    await refused(e, create(false), e.creator.kp, "MintNeedsApproval");
    await refused(e, create(true), e.creator.kp, "AccountNotInitialized");               // claiming an approval that does not exist
    await refused(e, L.approveQuoteMintIx(e.creator.kp.publicKey, e.mint, PROGRAM), e.creator.kp, "Unauthorized");
    await ok(e, L.approveQuoteMintIx(e.admin.publicKey, e.mint, PROGRAM), e.admin);
    const made = await ok(e, create(true), e.creator.kp);

    // The vault Token-2022 made is the size THIS mint requires: 165 + type byte
    // + TransferHookAccount (4+1) + PausableAccount (4+0).
    expect(String(raw(e, vault).programAddress)).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    expect(raw(e, vault).data.length).toBe(175);
    expect(balance(e, vault)).toBe(500n * TOKENS);
    expect(state().decimals).toBe(8);

    // ── the same market, at 8 decimals ──────────────────────────────────────
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await ok(e, L.openLadderIx(refs, e.trader.kp.publicKey, e.priceAccount(NVDA_UPDATE), ser.series), e.trader.kp);
    const W = L.binFor(22_460_000n, state().p0, state().stepBps);

    const quoted = async (shape: L.Shape, shares: bigint) => {
      const m = state(), had = balance(e, e.trader.token);
      const q = L.quoteTrade({ curve: m.curve, b: m.b, feeBps: L.feeBpsAt(m.feeBps, BigInt((e.svm.getClock() as any).unixTimestamp), m.settlesAt), decimals: m.decimals }, shape, shares);
      const r = await ok(e, L.tradeLadderIx(refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape, shares, limit: q.total }), e.trader.kp);
      expect(balance(e, e.trader.token) - had).toBe(shares > 0n ? -q.total : q.total);
      expect(state().curve.w).toEqual(q.curve.w);
      return r;
    };
    const tent = await quoted(L.tent(W, 4), 10n * TOKENS);
    await quoted(L.band(20, 44), 20n * TOKENS);
    await quoted(L.tent(10, 3), 5n * TOKENS);
    await quoted(L.tent(10, 3), -5n * TOKENS);

    const join = await ok(e, L.joinLadderIx(refs, { lp: e.lp.kp.publicKey, lpToken: e.lp.token, index: 0, deposit: 250n * TOKENS, expectedSeq: state().curveSeq }), e.lp.kp);

    warpClockTo(e.ctx, settlesAt + 5n);
    await ok(e, L.settleLadderIx(refs, ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(22_460_000n, settlesAt, settlesAt - 1n)), e.trader.token), e.trader.kp);
    expect(state().settledBin).toBe(W);

    const pre = balance(e, e.trader.token);
    await ok(e, L.redeemLadderIx(refs, e.trader.kp.publicKey, e.trader.token, L.tent(W, 4)), e.trader.kp);
    expect(balance(e, e.trader.token) - pre).toBe(40n * TOKENS);                          // centre of a height-4 tent
    await ok(e, L.redeemLadderIx(refs, e.trader.kp.publicKey, e.trader.token, L.band(20, 44)), e.trader.kp);
    await ok(e, L.redeemLadderIx(refs, e.trader.kp.publicKey, e.trader.token, L.tent(10, 3)), e.trader.kp);
    await ok(e, L.claimLpIx(refs, e.creator.kp.publicKey, e.creator.token), e.creator.kp);
    await ok(e, L.claimLpIx(refs, e.lp.kp.publicKey, e.lp.token), e.lp.kp);
    await ok(e, L.collectLadderFeesIx(refs, e.trader.kp.publicKey, e.creator.token, e.treasuryToken), e.trader.kp);

    const dust = balance(e, vault);
    expect(dust).toBeLessThan(40n);
    const everyone = balance(e, e.creator.token) + balance(e, e.lp.token) + balance(e, e.trader.token) + balance(e, e.treasuryToken) + dust;
    expect(everyone).toBe(30_000n * TOKENS);

    // ── revoking stops the next market, not this one ────────────────────────
    await ok(e, L.revokeQuoteMintIx(e.admin.publicKey, e.mint, PROGRAM), e.admin);
    const next = L.createLadderIx({ ...key, index: ser.indexOf(settlesAt + 86_400n), creator: e.creator.kp.publicKey, creatorToken: e.creator.token,
      tokenProgram: TOKEN_2022_PROGRAM_ID, seed: 500n * TOKENS, issuerTrusted: true, programId: PROGRAM });
    await refused(e, next, e.creator.kp, "AccountNotInitialized");

    console.log(`\nTOKEN-2022  real NVDAx mint (679 B, 8 dp, 8 extensions) → issuer-trusted → approved → full lifecycle
  compute units: create ${made.cu} · tent ${tent.cu} · late LP join ${join.cu}
  vault: 175 B Token-2022 account; dust left ${dust} of 10^-8 NVDAx; supply conserved\n`);
  });
});

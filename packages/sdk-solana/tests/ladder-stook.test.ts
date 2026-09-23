// A ladder quoted in $STOOK — the real mint, byte for byte
// (`GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu`, read from mainnet 2026-09-22):
// Token-2022, 6 decimals, a 1% transfer fee set by StonkFun on every transfer.
//
// What this proves: every deposit is credited by what ARRIVED. The wallet
// sends the gross the SDK computes, Token-2022 takes its 1%, the vault gets
// exactly the net the program books, and at the end the vault holds what it
// owes — plus the withheld fees, which belong to StonkFun, not to the pool.
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
import { testSeries } from "./fixtures/series";

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

// A Token-2022 account for a fee-bearing mint: base, type byte, then the
// TransferFeeAmount extension (type 2, 8 bytes) that holds withheld fees.
const ACCOUNT_TAIL = Buffer.from([2, 2, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function boot() {
  const svm = new LiteSVM(); svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) => ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data });
  const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const admin = Keypair.generate(); svm.airdrop(admin.publicKey.toBase58() as any, 10_000_000_000n as any);
  put(config, PROGRAM, Buffer.concat([disc("ProtocolConfig"), admin.publicKey.toBuffer(), Buffer.alloc(32), admin.publicKey.toBuffer(), Buffer.from([0, bump]), Buffer.alloc(30)]));
  const mint = Keypair.generate().publicKey; put(mint, TOKEN_2022_PROGRAM_ID, STOOK);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const base = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, base);
    put(key, TOKEN_2022_PROGRAM_ID, Buffer.concat([base, ACCOUNT_TAIL])); return key;
  };
  const START = 10_000n * T;
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
  return { err: r.result, logs: (r.meta?.logMessages ?? []).join("\n") };
}
const ok = async (e: Env, ix: TransactionInstruction, by: Keypair) => { const r = await send(e, ix, by); expect(r.err, r.logs).toBeNull(); return r; };
const refused = async (e: Env, ix: TransactionInstruction, by: Keypair, why: string) => { const r = await send(e, ix, by); expect(r.err).not.toBeNull(); expect(r.logs).toContain(why); };
const raw = (e: Env, k: PublicKey) => e.svm.getAccount(k.toBase58() as any) as any;
const acct = (e: Env, k: PublicKey) => { const d = Buffer.from(raw(e, k).data); return { amount: AccountLayout.decode(d.subarray(0, ACCOUNT_SIZE)).amount, withheld: d.length >= 178 ? d.readBigUInt64LE(170) : 0n }; };
const balance = (e: Env, k: PublicKey) => acct(e, k).amount;

describe("a ladder quoted in $STOOK, a 1% transfer-fee mint", () => {
  it("credits every deposit by what arrived, and ends with the vault holding what it owes", async () => {
    const e = boot();
    const report = L.classifyMint(STOOK, 1040n);
    expect(report.verdict).toBe("issuer-trusted");
    expect(report.transferFee).toEqual({ bps: 100, maxFee: 1_000_000_000_000_000n });
    const fee = report.transferFee!;

    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const ser = testSeries(NVDA_FEED, e.mint, settlesAt, e.admin.publicKey, PROGRAM);
    const key = { series: ser.series, index: ser.index, quoteMint: e.mint };
    const ladder = L.deriveLadderPda(key, PROGRAM);
    const refs: L.LadderRefs = { ladder, quoteMint: e.mint, tokenProgram: TOKEN_2022_PROGRAM_ID, programId: PROGRAM };
    const vault = L.deriveLadderVault(ladder, PROGRAM);
    const state = () => L.decodeLadder(new Uint8Array(raw(e, ladder).data));

    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    await ok(e, ser.createIx(), e.admin);
    const create = (t: boolean) => L.createLadderIx({ ...key, creator: e.creator.kp.publicKey, creatorToken: e.creator.token, tokenProgram: TOKEN_2022_PROGRAM_ID, seed: 1_000n * T, issuerTrusted: t, programId: PROGRAM });
    await refused(e, create(false), e.creator.kp, "MintNeedsApproval");
    await ok(e, L.approveQuoteMintIx(e.admin.publicKey, e.mint, PROGRAM), e.admin);

    // ── the seed: 1,000 booked, 1,010.11 sent, 10.11 withheld by the mint ──
    const c0 = balance(e, e.creator.token);
    await ok(e, create(true), e.creator.kp);
    const sent = c0 - balance(e, e.creator.token);
    expect(sent).toBe(L.grossFor(1_000n * T, fee));
    expect(sent).toBe(1_010_101_011n);
    expect(balance(e, vault)).toBe(1_000n * T);                          // exactly the net, as booked
    expect(acct(e, vault).withheld).toBe(sent - 1_000n * T);            // the fee sits in the vault account, StonkFun's to withdraw
    expect(state().cash).toBe(1_000n * T);
    expect(raw(e, vault).data.length).toBe(178);                          // base + type + TransferFeeAmount

    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await ok(e, L.openLadderIx(refs, e.trader.kp.publicKey, e.priceAccount(NVDA_UPDATE)), e.trader.kp);
    const W = L.binFor(22_460_000n, state().p0, state().stepBps);

    // ── a buy: the quote is the net; the wallet pays gross ─────────────────
    const buy = async (shape: L.Shape, shares: bigint) => {
      const m = state(), had = balance(e, e.trader.token), vaultHad = balance(e, vault);
      const q = L.quoteTrade({ curve: m.curve, b: m.b, feeBps: m.feeBps, decimals: m.decimals }, shape, shares);
      await ok(e, L.tradeLadderIx(refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape, shares, limit: q.total }), e.trader.kp);
      expect(had - balance(e, e.trader.token)).toBe(L.grossFor(q.total, fee));
      expect(balance(e, vault) - vaultHad).toBe(q.total);
      expect(state().curve.w).toEqual(q.curve.w);
      return q;
    };
    await buy(L.tent(W, 4), 20n * T);
    await buy(L.band(20, 44), 30n * T);

    // ── a sell: the vault sends the quote; the trader receives 1% less ──────
    {
      const m = state(), had = balance(e, e.trader.token);
      const q = L.quoteTrade({ curve: m.curve, b: m.b, feeBps: m.feeBps, decimals: m.decimals }, L.band(20, 44), -10n * T);
      await ok(e, L.tradeLadderIx(refs, { user: e.trader.kp.publicKey, userToken: e.trader.token, shape: L.band(20, 44), shares: -10n * T, limit: q.total }), e.trader.kp);
      expect(balance(e, e.trader.token) - had).toBe(L.netOf(q.total, fee));
    }

    // ── a late LP, same rule ────────────────────────────────────────────────
    const l0 = balance(e, e.lp.token);
    await ok(e, L.joinLadderIx(refs, { lp: e.lp.kp.publicKey, lpToken: e.lp.token, index: 0, deposit: 500n * T, expectedSeq: state().curveSeq }), e.lp.kp);
    expect(l0 - balance(e, e.lp.token)).toBe(L.grossFor(500n * T, fee));
    expect(state().depositTotal).toBe(1_500n * T);

    // ── settle, collect, and the vault is left holding only withheld fees ───
    warpClockTo(e.ctx, settlesAt + 5n);
    await ok(e, L.settleLadderIx(refs, ser.series, e.trader.kp.publicKey, e.priceAccount(updateAt(22_460_000n, settlesAt, settlesAt - 1n)), e.trader.token), e.trader.kp);
    expect(state().settledBin).toBe(W);
    for (const s of [L.tent(W, 4), L.band(20, 44)]) await ok(e, L.redeemLadderIx(refs, e.trader.kp.publicKey, e.trader.token, s), e.trader.kp);
    await ok(e, L.claimLpIx(refs, e.creator.kp.publicKey, e.creator.token), e.creator.kp);
    await ok(e, L.claimLpIx(refs, e.lp.kp.publicKey, e.lp.token), e.lp.kp);
    await ok(e, L.collectLadderFeesIx(refs, e.trader.kp.publicKey, e.creator.token, e.treasuryToken), e.trader.kp);

    const v = acct(e, vault);
    expect(v.amount).toBeLessThan(40n);                                  // the pool's own dust; `amount` excludes what the mint withheld
    const everyone = balance(e, e.creator.token) + balance(e, e.lp.token) + balance(e, e.trader.token) + balance(e, e.treasuryToken);
    const withheldEverywhere = [e.creator.token, e.lp.token, e.trader.token, e.treasuryToken, vault].reduce((a, k) => a + acct(e, k).withheld, 0n);
    // Nothing minted, nothing lost: what left the wallets is in the vault or withheld by the mint.
    expect(everyone + v.amount + withheldEverywhere).toBe(30_000n * T);

    // ── close: the vault holds withheld fees, which Token-2022 will not let
    // an account close over. The close harvests them to the mint first.
    expect(v.withheld).toBeGreaterThan(0n);
    const tBefore = balance(e, e.treasuryToken);
    await ok(e, L.closeLadderIx(refs, e.lp.kp.publicKey, e.creator.kp.publicKey, e.treasuryToken), e.lp.kp);
    expect(raw(e, vault)?.lamports ?? 0).toBeFalsy();
    expect(balance(e, e.treasuryToken) - tBefore).toBe(L.netOf(v.amount, fee));      // dust, less the coin's own fee on the way
    console.log(`\n$STOOK  1% transfer fee · seed of 1,000 cost 1,010.101011 to send · vault credited exactly 1,000 · lifecycle complete · ${(Number(withheldEverywhere) / 1e6).toFixed(6)} STOOK withheld for StonkFun across all accounts\n`);
  });
});

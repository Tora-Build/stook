// The ladder, end to end on LiteSVM, against the real program binary:
// create → open from a REAL Pyth account → buy a tent → buy a band → sell.
//
// Hand-rolled instructions on purpose. The SDK builders do not exist yet, and a
// test that goes through them would be testing two new things at once.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LiteSVM } from "litesvm";
import { SvmContext } from "./fixtures/svm";
import { warpClockTo } from "./fixtures/setup";

const PROGRAM = new PublicKey("EwiENXxrU3PEdmzCttJp9viCR6JZaFnFs3aW9n9a3EWw");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SO = process.env.STOOK_SO ?? resolve(__dirname, "../../../target/deploy/sooth_core.so");

// Equity.US.NVDA/USD, devnet account ics9eca…, read 2026-09-21: $220.19, 5 signatures.
const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");
const NVDA_UPDATE = Buffer.from("22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000", "hex");
const PUBLISH_TIME = 1_780_598_260n;

const disc = (ns: string, name: string) => createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8);
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const i16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Buffer, lamports = 10_000_000n) =>
    ctx.setAccount(key, { executable: false, owner, lamports, data: new Uint8Array(data) });

  // ProtocolConfig — written directly; this test is about the ladder, not protocol init.
  const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const admin = Keypair.generate();
  put(config, PROGRAM, Buffer.concat([
    disc("account", "ProtocolConfig"), admin.publicKey.toBuffer(), admin.publicKey.toBuffer(),
    u16(500), u16(100), u16(0), u16(5000), u16(3000), u16(1000), u16(1000),
    i64(0n), Buffer.from([configBump, 0, 0]), i64(0n), Buffer.alloc(32), Buffer.alloc(28),
  ]));

  // A 6-decimal classic SPL mint, and funded token accounts.
  const mint = Keypair.generate().publicKey;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  put(mint, TOKEN_PROGRAM_ID, mintData);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, TOKEN_PROGRAM_ID, d); return key;
  };
  const creator = Keypair.generate(), trader = Keypair.generate();
  for (const k of [creator, trader]) svm.airdrop(k.publicKey.toBase58() as any, 10_000_000_000n);
  const creatorToken = fund(creator.publicKey, 10_000_000_000n);
  const traderToken = fund(trader.publicKey, 10_000_000_000n);

  // The real Pyth update, owned by the real receiver program id.
  const priceUpdate = Keypair.generate().publicKey;
  put(priceUpdate, PYTH_RECEIVER, NVDA_UPDATE);

  return { svm, ctx, config, mint, creator, trader, creatorToken, traderToken, priceUpdate };
}

async function send(ctx: SvmContext, svm: LiteSVM, ixs: TransactionInstruction[], signer: Keypair) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.requestHeapFrame({ bytes: 262144 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.recentBlockhash = svm.latestBlockhash() as any; tx.feePayer = signer.publicKey; tx.sign(signer);
  const r = await ctx.banksClient.tryProcessTransaction(tx);
  return { err: r.result, cu: Number(r.meta?.computeUnitsConsumed ?? 0n), logs: r.meta?.logMessages ?? [] };
}

const TIER = 2; // 1% steps
const SEED = 5_000_000_000n; // 5,000 tokens

function keys(e: ReturnType<typeof boot>, settlesAt: bigint) {
  const ladder = pda([Buffer.from("ladder"), NVDA_FEED, i64(settlesAt), e.mint.toBuffer(), Buffer.from([TIER])]);
  return { ladder, authority: pda([Buffer.from("ladder_auth"), ladder.toBuffer()]), vault: pda([Buffer.from("ladder_vault"), ladder.toBuffer()]) };
}

const tradeIx = (e: ReturnType<typeof boot>, k: ReturnType<typeof keys>, lo: number, hi: number, h: number, shares: bigint, limit: bigint) => {
  const position = pda([Buffer.from("ladder_pos"), k.ladder.toBuffer(), e.trader.publicKey.toBuffer(), i16(lo), i16(hi), Buffer.from([h])]);
  return { position, ix: new TransactionInstruction({ programId: PROGRAM, data: Buffer.concat([disc("global", "ladder_trade"), i16(lo), i16(hi), Buffer.from([h]), i64(shares), u64(limit)]), keys: [
    { pubkey: e.trader.publicKey, isSigner: true, isWritable: true }, { pubkey: e.config, isSigner: false, isWritable: false },
    { pubkey: k.ladder, isSigner: false, isWritable: true }, { pubkey: k.authority, isSigner: false, isWritable: false },
    { pubkey: e.mint, isSigner: false, isWritable: false }, { pubkey: k.vault, isSigner: false, isWritable: true },
    { pubkey: e.traderToken, isSigner: false, isWritable: true }, { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ] }) };
};

const tokenBalance = (svm: LiteSVM, key: PublicKey) => AccountLayout.decode(Buffer.from((svm.getAccount(key.toBase58() as any) as any).data)).amount;

describe("ladder end to end", () => {
  it("creates, opens from a real Pyth update, and trades a tent, a band and a sell", async () => {
    const e = boot(); const { svm, ctx } = e;
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const k = keys(e, settlesAt);

    warpClockTo(ctx, PUBLISH_TIME - 1000n);
    const create = await send(ctx, svm, [new TransactionInstruction({ programId: PROGRAM,
      data: Buffer.concat([disc("global", "ladder_create"), NVDA_FEED, Buffer.from([TIER]), i64(opensAt), i64(locksAt), i64(settlesAt), u64(SEED), u16(100), Buffer.alloc(32)]),
      keys: [
        { pubkey: e.creator.publicKey, isSigner: true, isWritable: true }, { pubkey: e.config, isSigner: false, isWritable: false },
        { pubkey: k.ladder, isSigner: false, isWritable: true }, { pubkey: k.authority, isSigner: false, isWritable: false },
        { pubkey: e.mint, isSigner: false, isWritable: false }, { pubkey: k.vault, isSigner: false, isWritable: true },
        { pubkey: e.creatorToken, isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ] })], e.creator);
    expect(create.err, create.logs.join("\n")).toBeNull();
    expect(tokenBalance(svm, k.vault)).toBe(SEED);

    // Trading before open is refused.
    warpClockTo(ctx, PUBLISH_TIME + 10n);
    const early = await send(ctx, svm, [tradeIx(e, k, 31, 31, 1, 1_000_000n, 10n ** 12n).ix], e.trader);
    expect(early.err).not.toBeNull();

    const open = await send(ctx, svm, [new TransactionInstruction({ programId: PROGRAM, data: disc("global", "ladder_open"), keys: [
      { pubkey: e.trader.publicKey, isSigner: true, isWritable: false }, { pubkey: k.ladder, isSigner: false, isWritable: true },
      { pubkey: e.priceUpdate, isSigner: false, isWritable: false } ] })], e.trader);
    expect(open.err, open.logs.join("\n")).toBeNull();

    const before = tokenBalance(svm, e.traderToken);
    // A tent of height 4 centred on bin 32 — "draw a line".
    const tent = await send(ctx, svm, [tradeIx(e, k, 29, 35, 4, 100_000_000n, 10n ** 12n).ix], e.trader);
    expect(tent.err, tent.logs.join("\n")).toBeNull();
    const afterTent = tokenBalance(svm, e.traderToken);
    // 16 bin-levels of 100 shares at ~1/64 each ≈ 25 tokens, plus impact and 1% fee.
    const paidTent = before - afterTent;
    expect(paidTent).toBeGreaterThan(25_000_000n);
    expect(paidTent).toBeLessThan(30_000_000n);

    // A wide flat band.
    const band = await send(ctx, svm, [tradeIx(e, k, 20, 44, 1, 200_000_000n, 10n ** 12n).ix], e.trader);
    expect(band.err, band.logs.join("\n")).toBeNull();

    // Slippage limit is enforced.
    const tight = await send(ctx, svm, [tradeIx(e, k, 29, 35, 4, 100_000_000n, 1n).ix], e.trader);
    expect(tight.err).not.toBeNull();

    // Sell the whole tent back: strictly less than was paid for it.
    const preSell = tokenBalance(svm, e.traderToken);
    const sell = await send(ctx, svm, [tradeIx(e, k, 29, 35, 4, -100_000_000n, 0n).ix], e.trader);
    expect(sell.err, sell.logs.join("\n")).toBeNull();
    const got = tokenBalance(svm, e.traderToken) - preSell;
    expect(got).toBeGreaterThan(0n);

    // The tent sold for MORE than it cost — correctly: the band bought in
    // between overlaps its bins and raised their price. The claim that matters
    // is the clean one: buy and immediately sell, nothing in between, and the
    // trader must come out behind by the fees and the rounding.
    const rtBefore = tokenBalance(svm, e.traderToken);
    const rtBuy = await send(ctx, svm, [tradeIx(e, k, 50, 52, 2, 50_000_000n, 10n ** 12n).ix], e.trader);
    expect(rtBuy.err, rtBuy.logs.join("\n")).toBeNull();
    const rtSell = await send(ctx, svm, [tradeIx(e, k, 50, 52, 2, -50_000_000n, 0n).ix], e.trader);
    expect(rtSell.err, rtSell.logs.join("\n")).toBeNull();
    const roundTrip = tokenBalance(svm, e.traderToken) - rtBefore;
    expect(roundTrip).toBeLessThan(0n);

    // The books balance: what the vault holds is exactly pool cash plus fees.
    const raw = Buffer.from((svm.getAccount(k.ladder.toBase58() as any) as any).data);
    const at = (o: number) => raw.readBigUInt64LE(8 + o);
    const [p0, cash, fLp, fCr, fPr] = [raw.readBigInt64LE(8 + 24), at(32), at(48), at(56), at(64)];
    expect(p0).toBe(22_019_000n); // the grid centred on the real NVDA print, $220.19
    expect(tokenBalance(svm, k.vault)).toBe(cash + fLp + fCr + fPr);
    console.log(`  clean round trip P&L ${roundTrip} base units (must be negative); vault = cash ${cash} + fees ${fLp + fCr + fPr}`);

    // Selling what is not held is refused.
    const over = await send(ctx, svm, [tradeIx(e, k, 29, 35, 4, -1n, 0n).ix], e.trader);
    expect(over.err).not.toBeNull();

    console.log(`\nCOMPUTE UNITS (whole tx, real program on LiteSVM)\n  create ${create.cu}\n  open   ${open.cu}\n  buy tent h=4 (7 bins, inits position) ${tent.cu}\n  buy band (25 bins, inits position)    ${band.cu}\n  sell tent                              ${sell.cu}\n  tent cost ${paidTent} base units; sold back for ${got}\n`);
    expect(tent.cu).toBeLessThan(200_000);
    expect(band.cu).toBeLessThan(200_000);
  });
});

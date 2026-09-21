// The ladder, end to end on LiteSVM against the real program binary.
//
//   settle path: seed (two LPs) → open from a REAL Pyth account → trade →
//                settle → winners redeem → LPs claim → fees → vault empty
//   void path:   trade → settlement price never arrives → void →
//                trader refunded exactly what they paid, LP made whole
//
// Hand-rolled instructions on purpose. The SDK builders do not exist yet, and a
// test that went through them would be testing two new things at once.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
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
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const i16 = (v: number) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey: PublicKey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });

const TIER = 2; // 1% steps

function boot() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58() as any, SO);
  const ctx = new SvmContext(svm);
  const put = (key: PublicKey, owner: PublicKey, data: Buffer) =>
    ctx.setAccount(key, { executable: false, owner, lamports: 10_000_000n, data: new Uint8Array(data) });

  const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], PROGRAM);
  const treasury = Keypair.generate();
  put(config, PROGRAM, Buffer.concat([
    disc("account", "ProtocolConfig"), treasury.publicKey.toBuffer(), treasury.publicKey.toBuffer(),
    u16(500), u16(100), u16(0), u16(5000), u16(3000), u16(1000), u16(1000),
    i64(0n), Buffer.from([configBump, 0, 0]), i64(0n), Buffer.alloc(32), Buffer.alloc(28),
  ]));

  const mint = Keypair.generate().publicKey;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 10n ** 15n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  put(mint, TOKEN_PROGRAM_ID, mintData);
  const fund = (owner: PublicKey, amount: bigint) => {
    const key = Keypair.generate().publicKey; const d = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
    put(key, TOKEN_PROGRAM_ID, d); return key;
  };
  const who = (start: bigint) => { const kp = Keypair.generate(); svm.airdrop(kp.publicKey.toBase58() as any, 10_000_000_000n); return { kp, token: fund(kp.publicKey, start), start }; };
  const START = 10_000_000_000n;
  const creator = who(START), lp2 = who(START), trader = who(START);
  const treasuryToken = fund(treasury.publicKey, 0n);
  const priceAccount = (data: Buffer) => { const k = Keypair.generate().publicKey; put(k, PYTH_RECEIVER, data); return k; };

  return { svm, ctx, config, mint, creator, lp2, trader, treasuryToken, priceAccount };
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
  const ladder = pda([Buffer.from("ladder"), NVDA_FEED, i64(settlesAt), e.mint.toBuffer(), Buffer.from([TIER])]);
  const authority = pda([Buffer.from("ladder_auth"), ladder.toBuffer()]);
  const vault = pda([Buffer.from("ladder_vault"), ladder.toBuffer()]);
  const stakeOf = (o: PublicKey) => pda([Buffer.from("ladder_stake"), ladder.toBuffer(), o.toBuffer()]);
  const posOf = (o: PublicKey, lo: number, hi: number, h: number) => pda([Buffer.from("ladder_pos"), ladder.toBuffer(), o.toBuffer(), i16(lo), i16(hi), Buffer.from([h])]);
  const ix = (name: string, data: Buffer[], keys: any[]) => new TransactionInstruction({ programId: PROGRAM, data: Buffer.concat([disc("global", name), ...data]), keys });
  const tokenTail = [ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId)];
  return {
    ladder, vault, stakeOf, posOf,
    create: (seed: bigint, opens: bigint, locks: bigint) => ix("ladder_create",
      [NVDA_FEED, Buffer.from([TIER]), i64(opens), i64(locks), i64(settlesAt), u64(seed), u16(100), Buffer.alloc(32)],
      [signer(e.creator.kp.publicKey), ro(e.config), rw(ladder), ro(authority), ro(e.mint), rw(vault), rw(e.creator.token), rw(stakeOf(e.creator.kp.publicKey)), ...tokenTail]),
    seed: (w: Env["lp2"], amount: bigint) => ix("ladder_seed", [u64(amount)],
      [signer(w.kp.publicKey), rw(ladder), ro(e.mint), rw(vault), rw(w.token), rw(stakeOf(w.kp.publicKey)), ...tokenTail]),
    open: (price: PublicKey) => ix("ladder_open", [], [signer(e.trader.kp.publicKey, false), rw(ladder), ro(price)]),
    trade: (lo: number, hi: number, h: number, shares: bigint, limit: bigint) => ix("ladder_trade",
      [i16(lo), i16(hi), Buffer.from([h]), i64(shares), u64(limit)],
      [signer(e.trader.kp.publicKey), ro(e.config), rw(ladder), ro(authority), ro(e.mint), rw(vault), rw(e.trader.token), rw(posOf(e.trader.kp.publicKey, lo, hi, h)), ...tokenTail]),
    settle: (price: PublicKey) => ix("ladder_settle", [], [signer(e.trader.kp.publicKey, false), rw(ladder), ro(price)]),
    voidIt: () => ix("ladder_void", [], [signer(e.trader.kp.publicKey, false), rw(ladder)]),
    redeem: (lo: number, hi: number, h: number) => ix("ladder_redeem", [],
      [signer(e.trader.kp.publicKey), rw(ladder), ro(authority), ro(e.mint), rw(vault), rw(e.trader.token), rw(posOf(e.trader.kp.publicKey, lo, hi, h)), ro(TOKEN_PROGRAM_ID)]),
    claimLp: (w: Env["lp2"]) => ix("ladder_claim_lp", [],
      [signer(w.kp.publicKey), ro(ladder), ro(authority), ro(e.mint), rw(vault), rw(w.token), rw(stakeOf(w.kp.publicKey)), ro(TOKEN_PROGRAM_ID)]),
    collectFees: () => ix("ladder_collect_fees", [],
      [signer(e.trader.kp.publicKey, false), ro(e.config), rw(ladder), ro(authority), ro(e.mint), rw(vault), rw(e.creator.token), rw(e.treasuryToken), ro(TOKEN_PROGRAM_ID)]),
  };
}

const BIG = 10n ** 12n;

describe("ladder end to end", () => {
  it("seeds, opens from a real Pyth update, trades, settles, and pays everyone until the vault is empty", async () => {
    const e = boot();
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const m = market(e, settlesAt);

    // ── Seeding: the creator, then a second LP ─────────────────────────────
    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    const create = await ok(e, m.create(5_000_000_000n, opensAt, locksAt), e.creator.kp);
    await ok(e, m.seed(e.lp2, 2_500_000_000n), e.lp2.kp);
    expect(balance(e, m.vault)).toBe(7_500_000_000n);

    // ── Open, from the real update ──────────────────────────────────────────
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await refused(e, m.trade(31, 31, 1, 1_000_000n, BIG), e.trader.kp);           // not open yet
    const open = await ok(e, m.open(e.priceAccount(NVDA_UPDATE)), e.trader.kp);
    await refused(e, m.seed(e.lp2, 1_000_000n), e.lp2.kp);                          // liquidity is closed after open

    // ── Trading ─────────────────────────────────────────────────────────────
    const tent = await ok(e, m.trade(29, 35, 4, 100_000_000n, BIG), e.trader.kp);   // a line at bin 32
    const band = await ok(e, m.trade(20, 44, 1, 200_000_000n, BIG), e.trader.kp);   // a wide band
    await refused(e, m.trade(29, 35, 4, 100_000_000n, 1n), e.trader.kp);            // slippage limit
    const sell = await ok(e, m.trade(29, 35, 4, -100_000_000n, 0n), e.trader.kp);   // exit the first line
    await refused(e, m.trade(29, 35, 4, -1n, 0n), e.trader.kp);                     // nothing left to sell

    // a clean round trip never pays
    const rt0 = balance(e, e.trader.token);
    await ok(e, m.trade(50, 52, 2, 50_000_000n, BIG), e.trader.kp);
    await ok(e, m.trade(50, 52, 2, -50_000_000n, 0n), e.trader.kp);
    expect(balance(e, e.trader.token) - rt0).toBeLessThan(0n);

    // the line that will win: a tent centred on bin 33
    await ok(e, m.trade(30, 36, 4, 100_000_000n, BIG), e.trader.kp);

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
    const settle = await ok(e, m.settle(e.priceAccount(updateAt(price, settlesAt, settlesAt - 1n))), e.trader.kp);
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

    const c0 = balance(e, e.creator.token), l0 = balance(e, e.lp2.token);
    await ok(e, m.claimLp(e.creator), e.creator.kp);
    await ok(e, m.claimLp(e.lp2), e.lp2.kp);
    const creatorGot = balance(e, e.creator.token) - c0, lp2Got = balance(e, e.lp2.token) - l0;
    // 5,000 : 2,500 stake → 2 : 1 payout, to within a base unit of flooring
    expect(creatorGot - 2n * lp2Got).toBeGreaterThanOrEqual(-2n);
    expect(creatorGot - 2n * lp2Got).toBeLessThanOrEqual(2n);
    await refused(e, m.claimLp(e.lp2), e.lp2.kp);

    await ok(e, m.collectFees(), e.trader.kp);
    expect(balance(e, e.treasuryToken)).toBeGreaterThan(0n);

    // ── Conservation: nothing minted, nothing stranded beyond flooring dust ──
    const dust = balance(e, m.vault);
    expect(dust).toBeLessThan(10n);
    const total = balance(e, e.creator.token) + balance(e, e.lp2.token) + balance(e, e.trader.token) + balance(e, e.treasuryToken) + dust;
    expect(total).toBe(30_000_000_000n);

    const lpPnl = (creatorGot + lp2Got) - 7_500_000_000n;
    console.log(`\nSETTLE PATH  NVDA opened $220.19 → settled $224.60 (bin 33)
  compute units: create ${create.cu} · open ${open.cu} · tent ${tent.cu} · 25-bin band ${band.cu} · sell ${sell.cu} · settle ${settle.cu} · redeem ${redeem.cu}
  LPs put in 7,500.000000 and took out ${(Number(creatorGot + lp2Got) / 1e6).toFixed(6)}  (P&L ${(Number(lpPnl) / 1e6).toFixed(6)})
  vault dust left: ${dust} base units; total supply conserved\n`);
    for (const cu of [tent.cu, band.cu, sell.cu, settle.cu, redeem.cu]) expect(cu).toBeLessThan(200_000);
  });

  it("voids when the settlement price never arrives: the trader gets back what they paid, the LP is made whole", async () => {
    const e = boot();
    const opensAt = PUBLISH_TIME, locksAt = PUBLISH_TIME + 3600n, settlesAt = PUBLISH_TIME + 3700n;
    const m = market(e, settlesAt);

    warpClockTo(e.ctx, PUBLISH_TIME - 1000n);
    await ok(e, m.create(5_000_000_000n, opensAt, locksAt), e.creator.kp);
    warpClockTo(e.ctx, PUBLISH_TIME + 10n);
    await ok(e, m.open(e.priceAccount(NVDA_UPDATE)), e.trader.kp);

    // Pump one bin hard — the position that a mark-to-last-price refund would overpay.
    await ok(e, m.trade(40, 40, 1, 800_000_000n, BIG), e.trader.kp);
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

    await ok(e, m.claimLp(e.creator), e.creator.kp);
    expect(balance(e, e.creator.token)).toBe(e.creator.start);         // LP exactly whole
    expect(balance(e, m.vault)).toBe(0n);
    console.log(`\nVOID PATH  trader had paid ${(Number(paid) / 1e6).toFixed(6)}; refunded in full. LP made exactly whole. Vault 0.\n`);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeEvent, eventsByInstruction, EVENT_DISC, IX_DISC, parseTransaction, PROGRAM_ID } from "../src/decode.mjs";
import { b58decode, b58encode } from "../src/b58.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const has = (name) => readdirSync(new URL("./fixtures/", import.meta.url)).includes(`${name}.json`);

// ── keys and bytes for synthesized transactions ─────────────────────────────
const key = (n) => b58encode(createHash("sha256").update(`key${n}`).digest());
const K = { owner: key(1), keeper: key(2), ladder: key(3), mint: key(4), ata: key(5), position: key(6), vault: key(7), series: key(8), tranche: key(9), auth: key(10), cfg: key(11), tp: key(12) };
const TOKEN = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Borsh by hand, field by field: independent of the decoder's layout table. */
function bytes(parts) {
  const bufs = parts.map(([t, v]) => {
    const b = Buffer.alloc({ pk: 32, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, u128: 16 }[t]);
    if (t === "pk") Buffer.from(b58decode(v)).copy(b);
    else if (t === "u8") b.writeUInt8(v);
    else if (t === "i16") b.writeInt16LE(v);
    else if (t === "u16") b.writeUInt16LE(v);
    else if (t === "i32") b.writeInt32LE(v);
    else if (t === "u32") b.writeUInt32LE(v);
    else if (t === "i64") b.writeBigInt64LE(BigInt(v));
    else if (t === "u64") b.writeBigUInt64LE(BigInt(v));
    else if (t === "u128") { b.writeBigUInt64LE(BigInt(v) & (2n ** 64n - 1n)); b.writeBigUInt64LE(BigInt(v) >> 64n, 8); }
    return b;
  });
  return Buffer.concat(bufs);
}
const event = (name, parts) => `Program data: ${Buffer.concat([Buffer.from(EVENT_DISC[name], "hex"), bytes(parts)]).toString("base64")}`;
const ixData = (name) => b58encode(Buffer.from(IX_DISC[name], "hex"));
const bal = (i, amount, owner = K.owner, mint = K.mint) => ({ accountIndex: i, mint, owner, programId: TOKEN, uiTokenAmount: { amount: String(amount), decimals: 6 } });

/** A minimal jsonParsed transaction: heap frame first, then our instructions. */
function tx({ ixs, logs, pre = [], post = [], inner = [], err = null, keys = [] }) {
  return {
    slot: 100, blockTime: 1_790_000_000,
    meta: { err, logMessages: ["Program ComputeBudget111111111111111111111111111111 invoke [1]", "Program ComputeBudget111111111111111111111111111111 success", ...logs], preTokenBalances: pre, postTokenBalances: post, innerInstructions: inner },
    transaction: { signatures: ["SIG"], message: { accountKeys: keys.map((pubkey) => ({ pubkey })), instructions: [{ programId: "ComputeBudget111111111111111111111111111111", data: "1" }, ...ixs] } },
  };
}
const invoke = (lines) => [`Program ${PROGRAM_ID} invoke [1]`, ...lines, `Program ${PROGRAM_ID} success`];

// ── discriminators ───────────────────────────────────────────────────────────
test("instruction discriminators match the SDK's", () => {
  // packages/sdk-solana/src/ladder/instructions.ts DISC
  const sdk = {
    ladder_create: [165, 10, 127, 30, 41, 17, 252, 67], ladder_open: [88, 129, 233, 84, 136, 27, 112, 248],
    ladder_trade: [162, 88, 142, 115, 117, 138, 37, 209], ladder_lp_join: [232, 117, 195, 166, 157, 89, 197, 128],
    ladder_settle: [124, 60, 106, 236, 76, 223, 153, 206], ladder_void: [210, 181, 54, 242, 164, 19, 68, 196],
    ladder_redeem: [202, 8, 83, 149, 73, 199, 152, 198], ladder_claim_lp: [173, 17, 30, 112, 208, 75, 43, 242],
    ladder_collect_fees: [255, 191, 4, 129, 247, 197, 29, 170], ladder_sweep: [85, 148, 67, 229, 10, 130, 205, 62],
    ladder_close: [20, 102, 63, 170, 152, 236, 112, 5],
  };
  for (const [n, d] of Object.entries(sdk)) assert.equal(IX_DISC[n], Buffer.from(d).toString("hex"), n);
});

test("LadderTraded decodes exactly, negative fields included", () => {
  const raw = Buffer.concat([Buffer.from(EVENT_DISC.LadderTraded, "hex"), bytes([["pk", K.ladder], ["pk", K.owner], ["i16", -3], ["i16", 66], ["u8", 4], ["i64", -123456789012n], ["u64", 18446744073709551615n], ["u64", 7]])]);
  assert.deepEqual(decodeEvent(raw.toString("base64")), { name: "LadderTraded", ladder: K.ladder, user: K.owner, lo: -3, hi: 66, h: 4, shares: -123456789012n, amount: 18446744073709551615n, fee: 7n });
});

test("every event decodes exactly", () => {
  const cases = {
    LadderCreated: [[["pk", K.ladder], ["pk", K.owner], ["pk", K.series], ["u32", 20361], ["i64", 1], ["i64", 2], ["i64", 1_790_000_000], ["u64", 5_000_000]], { ladder: K.ladder, creator: K.owner, series: K.series, index: 20361, opens_at: 1n, locks_at: 2n, settles_at: 1790000000n, seed: 5000000n }],
    LadderOpened: [[["pk", K.ladder], ["i64", 6_500_000_000_000n], ["i32", -8], ["u128", 2n ** 100n + 5n], ["u16", 100]], { ladder: K.ladder, p0: 6500000000000n, exponent: -8, b: 2n ** 100n + 5n, step_bps: 100 }],
    LadderVoided: [[["pk", K.ladder], ["u64", 9]], { ladder: K.ladder, refundable: 9n }],
    LadderLpJoined: [[["pk", K.ladder], ["pk", K.owner], ["u8", 2], ["u64", 1000], ["u128", 77], ["u64", 3]], { ladder: K.ladder, owner: K.owner, index: 2, deposit: 1000n, b: 77n, curve_seq: 3n }],
    LadderSettled: [[["pk", K.ladder], ["i64", -5], ["i32", -8], ["u8", 63], ["u64", 1], ["u64", 2], ["u64", 3]], { ladder: K.ladder, price: -5n, exponent: -8, bin: 63, owed_to_winners: 1n, lp_pool: 2n, bounty: 3n }],
    LadderLpClaimed: [[["pk", K.ladder], ["pk", K.owner], ["u8", 0], ["u64", 10], ["u64", 11], ["u64", 12]], { ladder: K.ladder, owner: K.owner, index: 0, deposit: 10n, principal: 11n, fees: 12n }],
    LadderClosed: [[["pk", K.ladder], ["u64", 4]], { ladder: K.ladder, dust: 4n }],
    SeriesObserved: [[["pk", K.series], ["u32", 20361], ["i64", 6_500_000_000_000n], ["u128", 123], ["u32", 21]], { series: K.series, index: 20361, price: 6500000000000n, var_wad: 123n, observations: 21 }],
  };
  const feed = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const sc = Buffer.concat([Buffer.from(EVENT_DISC.SeriesCreated, "hex"), bytes([["pk", K.series]]), Buffer.from(feed, "hex"), bytes([["pk", K.mint], ["u32", 0], ["u32", 72_000], ["u8", 2]])]);
  assert.deepEqual(decodeEvent(sc.toString("base64")), { name: "SeriesCreated", series: K.series, feed_id: feed, quote_mint: K.mint, period_secs: 0, close_secs: 72_000, clock: 2 });
  for (const [name, [parts, want]] of Object.entries(cases)) {
    const b64 = Buffer.concat([Buffer.from(EVENT_DISC[name], "hex"), bytes(parts)]).toString("base64");
    assert.deepEqual(decodeEvent(b64), { name, ...want }, name);
  }
  // a payload cut short is refused, not misread
  assert.equal(decodeEvent(Buffer.from(EVENT_DISC.LadderClosed + "00", "hex").toString("base64")), null);
  // and one longer than the struct is an earlier layout: refused too
  const long = Buffer.concat([Buffer.from(EVENT_DISC.LadderClosed, "hex"), bytes([["pk", K.ladder], ["u64", 4], ["u64", 5]])]);
  assert.equal(decodeEvent(long.toString("base64")), null);
});

test("a transaction from an earlier layout of the program gives no rows", () => {
  // recorded 2026-09-23: LadderCreate with 11 accounts and a 169-byte event
  const p = parseTransaction(fixture("old_create"));
  assert.deepEqual(p.rows, []);
  assert.deepEqual(p.rounds, {});
});

test("events are tied to their instruction; other programs' data is ignored", () => {
  const ev = event("LadderClosed", [["pk", K.ladder], ["u64", 1]]);
  const logs = [
    "Program Other1111111111111111111111111111111111 invoke [1]", ev, "Program Other1111111111111111111111111111111111 success",
    `Program ${PROGRAM_ID} invoke [1]`, `Program ${TOKEN} invoke [2]`, ev, `Program ${TOKEN} success`, ev, `Program ${PROGRAM_ID} success`,
  ];
  const out = eventsByInstruction(logs);
  assert.equal(out.length, 1);
  assert.equal(out[0].ix, 1);
});

// ── every kind ───────────────────────────────────────────────────────────────
const tradeAccounts = (user = K.owner) => [user, K.cfg, K.ladder, K.auth, K.mint, K.vault, K.ata, K.position, K.tp, "11111111111111111111111111111111"];

test("buy and sell: amounts are what left and reached the wallet", () => {
  const keys = [K.owner, K.ata];
  const t = (shares, amount, fee, pre, post) => parseTransaction(tx({
    keys, ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_trade"), accounts: tradeAccounts() }],
    logs: invoke([event("LadderTraded", [["pk", K.ladder], ["pk", K.owner], ["i16", 29], ["i16", 35], ["u8", 4], ["i64", shares], ["u64", amount], ["u64", fee]])]),
    pre: [bal(1, pre)], post: [bal(1, post)],
  }));
  const b = t(1_000_000, 400_000, 8_000, 10_000_000, 9_579_760);   // 3% transfer fee on top
  assert.equal(b.rows.length, 1);
  assert.deepEqual({ ...b.rows[0] }, { sig: "SIG", ix: 1, sub: 0, slot: 100, time: 1_790_000_000, ladder: K.ladder, mint: K.mint, decimals: 6, lo: 29, hi: 35, h: 4, shares: "1000000", position: K.position, tranche: null, by: null, amountIn: "420240", amountOut: "0", fee: "8000", wallet: K.owner, kind: "buy" });
  assert.deepEqual(b.rounds[K.ladder], { quoteMint: K.mint, decimals: 6 });
  const s = t(-500_000, 200_000, 4_000, 1_000, 191_120);
  assert.equal(s.rows[0].kind, "sell"); assert.equal(s.rows[0].amountOut, "190120"); assert.equal(s.rows[0].shares, "-500000");
});

test("two trades on one token account fall back to the program's own figures", () => {
  const ev = (sh, amt, fee) => event("LadderTraded", [["pk", K.ladder], ["pk", K.owner], ["i16", 30], ["i16", 30], ["u8", 1], ["i64", sh], ["u64", amt], ["u64", fee]]);
  const p = parseTransaction(tx({
    keys: [K.owner, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_trade"), accounts: tradeAccounts() }, { programId: PROGRAM_ID, data: ixData("ladder_trade"), accounts: tradeAccounts() }],
    logs: [...invoke([ev(100, 50, 1)]), ...invoke([ev(-40, 20, 1)])],
    pre: [bal(1, 1000)], post: [bal(1, 968)],
  }));
  assert.deepEqual(p.rows.map((r) => [r.ix, r.kind, r.amountIn, r.amountOut]), [[1, "buy", "51", "0"], [2, "sell", "0", "19"]]);
});

test("redeem: no event, the amount is the owner's balance change; a keeper's redeem is the owner's", () => {
  const accounts = (caller) => [caller, K.owner, K.ladder, K.auth, K.mint, K.vault, K.ata, K.position, K.tp];
  const mk = (caller) => parseTransaction(tx({
    keys: [caller, K.owner, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_redeem"), accounts: accounts(caller) }],
    logs: invoke(["Program log: Instruction: LadderRedeem"]),
    pre: [bal(2, 5)], post: [bal(2, 4_500_005)],
    inner: [{ index: 1, instructions: [{ program: "spl-token", programId: TOKEN, parsed: { type: "transferChecked", info: { destination: K.ata, source: K.vault, tokenAmount: { amount: "4639175" } } } }] }],
  }));
  const own = mk(K.owner).rows[0];
  assert.deepEqual([own.kind, own.wallet, own.by, own.amountOut, own.position], ["redeem", K.owner, null, "4500000", K.position]);
  const swept = mk(K.keeper).rows[0];
  assert.deepEqual([swept.wallet, swept.by, swept.amountOut], [K.owner, K.keeper, "4500000"]);
});

test("keeper sweep and keeper claim are attributed to the owner", () => {
  const sweep = parseTransaction(tx({ keys: [K.keeper], ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_sweep"), accounts: [K.keeper, K.ladder, K.position, K.owner] }], logs: invoke([]) }));
  assert.deepEqual(sweep.rows.map((r) => [r.kind, r.wallet, r.by, r.position, r.amountOut]), [["sweep", K.owner, K.keeper, K.position, "0"]]);
  const claim = parseTransaction(tx({
    keys: [K.keeper, K.owner, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_claim_lp"), accounts: [K.keeper, K.owner, K.ladder, K.auth, K.mint, K.vault, K.ata, K.tranche, K.tp] }],
    logs: invoke([event("LadderLpClaimed", [["pk", K.ladder], ["pk", K.owner], ["u8", 1], ["u64", 1000], ["u64", 1100], ["u64", 30]])]),
    pre: [bal(2, 0)], post: [bal(2, 1095)],
  }));
  assert.deepEqual(claim.rows.map((r) => [r.kind, r.wallet, r.by, r.tranche, r.amountOut]), [["claim", K.owner, K.keeper, 1, "1095"]]);
});

test("create, join, fees; open, settle, void and close become round facts", () => {
  const create = parseTransaction(tx({
    keys: [K.owner, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_create"), accounts: [K.owner, K.cfg, K.series, K.ladder, K.auth, K.mint, K.vault, K.ata, K.tranche, K.tp, "11111111111111111111111111111111", PROGRAM_ID] }],
    logs: invoke([event("LadderCreated", [["pk", K.ladder], ["pk", K.owner], ["pk", K.series], ["u32", 7], ["i64", 10], ["i64", 20], ["i64", 30], ["u64", 5000]])]),
    pre: [bal(1, 10_000)], post: [bal(1, 4_850)],
  }));
  assert.deepEqual(create.rows.map((r) => [r.kind, r.wallet, r.tranche, r.amountIn]), [["start", K.owner, 0, "5150"]]);
  assert.equal(create.rounds[K.ladder].settlesAt, 30); assert.equal(create.rounds[K.ladder].series, K.series); assert.equal(create.rounds[K.ladder].index, 7);

  const join = parseTransaction(tx({
    keys: [K.owner, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_lp_join"), accounts: [K.owner, K.cfg, K.ladder, K.mint, K.vault, K.ata, K.tranche, K.tp, "11111111111111111111111111111111"] }],
    logs: invoke([event("LadderLpJoined", [["pk", K.ladder], ["pk", K.owner], ["u8", 3], ["u64", 2000], ["u128", 1], ["u64", 9]])]),
    pre: [bal(1, 3000)], post: [bal(1, 1000)],
  }));
  assert.deepEqual(join.rows.map((r) => [r.kind, r.tranche, r.amountIn]), [["deposit", 3, "2000"]]);

  const fees = parseTransaction(tx({
    keys: [K.keeper, K.ata],
    ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_collect_fees"), accounts: [K.keeper, K.cfg, K.ladder, K.auth, K.mint, K.vault, K.ata, key(20), K.tp] }],
    logs: invoke([]), pre: [bal(1, 0)], post: [bal(1, 77)],
  }));
  assert.deepEqual(fees.rows.map((r) => [r.kind, r.wallet, r.amountOut]), [["fees", K.owner, "77"]]);

  const facts = parseTransaction(tx({
    keys: [K.keeper],
    ixs: [
      { programId: PROGRAM_ID, data: ixData("ladder_open"), accounts: [K.keeper, K.ladder] },
      { programId: PROGRAM_ID, data: ixData("ladder_settle"), accounts: [K.keeper, K.ladder] },
      { programId: PROGRAM_ID, data: ixData("ladder_close"), accounts: [K.keeper, K.cfg, K.ladder] },
    ],
    logs: [
      ...invoke([event("LadderOpened", [["pk", K.ladder], ["i64", 6_500_000_000_000n], ["i32", -8], ["u128", 1], ["u16", 100]])]),
      ...invoke([event("LadderSettled", [["pk", K.ladder], ["i64", 6_510_000_000_000n], ["i32", -8], ["u8", 32], ["u64", 1], ["u64", 2], ["u64", 3]])]),
      ...invoke([event("LadderClosed", [["pk", K.ladder], ["u64", 4]])]),
    ],
  }));
  assert.equal(facts.rows.length, 0, "the keeper's bounty is not a round played");
  const r = facts.rounds[K.ladder];
  assert.deepEqual([r.p0, r.expo, r.stepBps, r.settled.bin, r.settled.price, r.closed.dust], ["6500000000000", -8, 100, 32, "6510000000000", "4"]);

  const voided = parseTransaction(tx({ keys: [K.keeper], ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_void"), accounts: [K.keeper, K.ladder] }], logs: invoke([event("LadderVoided", [["pk", K.ladder], ["u64", 9]])]) }));
  assert.deepEqual(voided.rounds[K.ladder].voided, { time: 1_790_000_000, sig: "SIG", refundable: "9" });
});

test("a failed transaction is skipped", () => {
  const p = parseTransaction(tx({ err: { InstructionError: [1, { Custom: 6000 }] }, keys: [K.owner], ixs: [{ programId: PROGRAM_ID, data: ixData("ladder_trade"), accounts: tradeAccounts() }], logs: invoke([event("LadderClosed", [["pk", K.ladder], ["u64", 1]])]) }));
  assert.deepEqual(p, { sig: "SIG", skipped: "failed" });
  assert.equal(parseTransaction(null).skipped, "missing");
});

// ── recorded devnet transactions ─────────────────────────────────────────────
test("recorded sell on a 3% transfer-fee coin: the wallet's real receipt", () => {
  const p = parseTransaction(fixture("sell"));
  assert.equal(p.rows.length, 1);
  const r = p.rows[0];
  assert.deepEqual([r.kind, r.wallet, r.lo, r.hi, r.h, r.shares, r.fee, r.decimals], ["sell", "FXpKecQpoSYoFuFmFcv7K5fMYxHUMiFjjBpo7yBjwezd", 27, 33, 1, "-26472517107", "444093071", 9]);
  // 15503.015585000 - 15491.379960927 in the wallet; 11.995488736 left the vault
  assert.equal(r.amountOut, "11635624073");
});

test("recorded buy", () => {
  const r = parseTransaction(fixture("buy")).rows[0];
  assert.deepEqual([r.kind, r.wallet, r.lo, r.hi, r.h, r.shares], ["buy", "6Q4djZFEJJiC6wWVCYE5uzM7ejEd9TVLo3QzkUJhrpNz", 29, 35, 4, "499725132"]);
  assert.equal(r.amountIn, "1233408065");
});

const RECORDED = {
  create: (p) => p.rows.some((r) => r.kind === "start") && Object.values(p.rounds).some((r) => r.settlesAt),
  open: (p) => Object.values(p.rounds).some((r) => r.p0),
  deposit: (p) => p.rows.some((r) => r.kind === "deposit" && BigInt(r.amountIn) > 0n),
  settle: (p) => Object.values(p.rounds).some((r) => r.settled && r.settled.bin >= 0),
  redeem: (p) => p.rows.some((r) => r.kind === "redeem" && BigInt(r.amountOut) > 0n),
  claim: (p) => p.rows.some((r) => r.kind === "claim" && BigInt(r.amountOut) > 0n),
  sweep: (p) => p.rows.some((r) => r.kind === "sweep" && r.amountOut === "0"),
  fees: (p) => p.rows.some((r) => r.kind === "fees"),
  void: (p) => Object.values(p.rounds).some((r) => r.voided),
  close: (p) => Object.values(p.rounds).some((r) => r.closed),
};
for (const [name, ok] of Object.entries(RECORDED)) {
  test(`recorded ${name}`, { skip: !has(name) && "no fixture recorded" }, () => {
    const p = parseTransaction(fixture(name));
    assert.ok(!p.skipped, "not skipped");
    assert.ok(ok(p), JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 600));
  });
}

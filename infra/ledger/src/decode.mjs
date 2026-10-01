// One sooth_core transaction into ledger rows.
//
// Events come from the "Program data:" log lines (Anchor's emit!): an 8-byte
// discriminator, sha256("event:<Name>")[..8], then the struct's fields in
// borsh. Instructions are told apart by their own 8 bytes,
// sha256("global:<name>")[..8], and their accounts by position, as the
// program's `#[derive(Accounts)]` structs order them. Redeem emits nothing:
// what it paid is read from the token balance it moved.
//
// A row is something a wallet did, or had done for it, in one round:
//   start    created the round; its seed is the first house deposit
//   buy      bought a call (shown as "call", or "add" when the wallet already
//            held that same call)
//   sell     sold some or all of one
//   deposit  joined the house
//   redeem   collected a position (shown as "collect", or "refund" on a void)
//   claim    collected a house deposit
//   fees     the round starter's share of the fees, paid out
//   sweep    a position owed nothing, closed by anyone (rent back to the owner)
// Redeem and claim may be signed by a keeper after the grace period; the row
// belongs to the position's owner, with the keeper in `by`.
//
// Round facts (series, close time, grid, settlement, void, close) go to
// `rounds`, series facts to `series`, each as a partial record. Every field
// comes from exactly one kind of event, so merging them in any order gives
// the same round: the backfill walks history newest first.

import { createHash } from "node:crypto";
import { b58decode, b58encode } from "./b58.mjs";

export const PROGRAM_ID = "55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353";

const disc = (ns, name) => createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8).toString("hex");

// ── instructions ─────────────────────────────────────────────────────────────

const IX = [
  "initialize_protocol", "set_paused", "set_treasury", "transfer_authority", "accept_authority",
  "approve_quote_mint", "revoke_quote_mint",
  "ladder_create", "ladder_open", "ladder_trade", "ladder_lp_join", "ladder_settle", "ladder_void",
  "ladder_redeem", "ladder_claim_lp", "ladder_collect_fees", "ladder_sweep", "ladder_close",
  "series_create", "series_set", "series_observe",
];
export const IX_DISC = Object.fromEntries(IX.map((n) => [n, disc("global", n)]));
const IX_BY_DISC = new Map(IX.map((n) => [IX_DISC[n], n]));

/**
 * Account positions, from the program's Accounts structs, and how many
 * accounts the instruction takes (`n`, as the SDK's builders send them; an
 * Anchor optional account is still passed, as the program id). The program is
 * upgraded in place: an instruction with another count was built for an
 * earlier layout, and its accounts are not read.
 */
const ACC = {
  ladder_create: { n: 12, creator: 0, series: 2, ladder: 3, mint: 5, token: 7, tranche: 8 },
  ladder_open: { n: 4, ladder: 1 },
  ladder_trade: { n: 10, user: 0, ladder: 2, mint: 4, token: 6, position: 7 },
  ladder_lp_join: { n: 9, lp: 0, ladder: 2, mint: 3, token: 5, tranche: 6 },
  ladder_settle: { n: 9, cranker: 0, ladder: 1, mint: 5, token: 7 },
  ladder_void: { n: 3, ladder: 1 },
  ladder_redeem: { n: 9, caller: 0, owner: 1, ladder: 2, mint: 4, token: 6, position: 7 },
  ladder_claim_lp: { n: 9, caller: 0, owner: 1, ladder: 2, mint: 4, token: 6, tranche: 7 },
  ladder_collect_fees: { n: 9, ladder: 2, mint: 4, token: 6 },
  ladder_sweep: { n: 4, cranker: 0, ladder: 1, position: 2, owner: 3 },
  ladder_close: { n: 9, ladder: 2 },
};

// ── events ───────────────────────────────────────────────────────────────────

const EVENTS = {
  ProtocolInitialized: [["authority", "pk"], ["treasury", "pk"]],
  ProtocolPausedEvent: [["authority", "pk"], ["paused", "bool"]],
  TreasuryChanged: [["authority", "pk"], ["treasury", "pk"]],
  AuthorityTransferStarted: [["authority", "pk"], ["nominee", "pk"]],
  AuthorityTransferAccepted: [["previous", "pk"], ["authority", "pk"]],
  SeriesCreated: [["series", "pk"], ["feed_id", "b32"], ["quote_mint", "pk"], ["period_secs", "u32"], ["close_secs", "u32"], ["clock", "u8"]],
  SeriesObserved: [["series", "pk"], ["index", "u32"], ["price", "i64"], ["var_wad", "i128"], ["observations", "u32"]],
  LadderCreated: [["ladder", "pk"], ["creator", "pk"], ["series", "pk"], ["index", "u32"], ["opens_at", "i64"], ["locks_at", "i64"], ["settles_at", "i64"], ["seed", "u64"]],
  LadderOpened: [["ladder", "pk"], ["p0", "i64"], ["exponent", "i32"], ["b", "u128"], ["step_bps", "u16"]],
  LadderVoided: [["ladder", "pk"], ["refundable", "u64"]],
  LadderTraded: [["ladder", "pk"], ["user", "pk"], ["lo", "i16"], ["hi", "i16"], ["h", "u8"], ["shares", "i64"], ["amount", "u64"], ["fee", "u64"]],
  LadderLpJoined: [["ladder", "pk"], ["owner", "pk"], ["index", "u8"], ["deposit", "u64"], ["b", "u128"], ["curve_seq", "u64"]],
  LadderSettled: [["ladder", "pk"], ["price", "i64"], ["exponent", "i32"], ["bin", "u8"], ["owed_to_winners", "u64"], ["lp_pool", "u64"], ["bounty", "u64"]],
  LadderLpClaimed: [["ladder", "pk"], ["owner", "pk"], ["index", "u8"], ["deposit", "u64"], ["principal", "u64"], ["fees", "u64"]],
  LadderClosed: [["ladder", "pk"], ["dust", "u64"]],
};
export const EVENT_DISC = Object.fromEntries(Object.keys(EVENTS).map((n) => [n, disc("event", n)]));
const EVENT_BY_DISC = new Map(Object.keys(EVENTS).map((n) => [EVENT_DISC[n], n]));

const SIZE = { pk: 32, b32: 32, bool: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, u128: 16, i128: 16 };

/** One "Program data:" payload into { name, ...fields }, or null if it is not
 *  one of ours. The payload must be exactly the struct's size: an event from
 *  an earlier layout of the program is refused, not misread. */
export function decodeEvent(base64) {
  const d = Buffer.from(base64, "base64");
  if (d.length < 8) return null;
  const name = EVENT_BY_DISC.get(d.subarray(0, 8).toString("hex"));
  if (!name) return null;
  const out = { name };
  let at = 8;
  for (const [field, t] of EVENTS[name]) {
    if (at + SIZE[t] > d.length) return null;
    switch (t) {
      case "pk": out[field] = b58encode(d.subarray(at, at + 32)); break;
      case "b32": out[field] = d.subarray(at, at + 32).toString("hex"); break;
      case "bool": out[field] = d[at] === 1; break;
      case "u8": out[field] = d[at]; break;
      case "i16": out[field] = d.readInt16LE(at); break;
      case "u16": out[field] = d.readUInt16LE(at); break;
      case "i32": out[field] = d.readInt32LE(at); break;
      case "u32": out[field] = d.readUInt32LE(at); break;
      case "i64": out[field] = d.readBigInt64LE(at); break;
      case "u64": out[field] = d.readBigUInt64LE(at); break;
      case "u128": out[field] = d.readBigUInt64LE(at) | (d.readBigUInt64LE(at + 8) << 64n); break;
      case "i128": out[field] = d.readBigUInt64LE(at) | (d.readBigInt64LE(at + 8) << 64n); break;
    }
    at += SIZE[t];
  }
  return at === d.length ? out : null;
}

/**
 * Which top-level instruction each of our events came from. Every top-level
 * instruction logs one "invoke [1]"; an event belongs to the program on top of
 * the invoke stack when it is logged, and only ours count.
 */
export function eventsByInstruction(logs, programId = PROGRAM_ID) {
  const out = [];
  const stack = [];
  let top = -1;
  for (const line of logs ?? []) {
    let m;
    if ((m = /^Program (\S+) invoke \[(\d+)\]$/.exec(line))) { if (m[2] === "1") { top++; stack.length = 0; } stack.push(m[1]); continue; }
    if ((m = /^Program (\S+) (success|failed)/.exec(line))) { stack.pop(); continue; }
    if ((m = /^Program data: (\S+)/.exec(line)) && stack[stack.length - 1] === programId) {
      const e = decodeEvent(m[1]);
      if (e) out.push({ ix: top, event: e });
    }
  }
  return out;
}

// ── the transaction ──────────────────────────────────────────────────────────

const keyOf = (k) => (typeof k === "string" ? k : k.pubkey);
const s = (v) => (v === null || v === undefined ? null : String(v));

/**
 * A jsonParsed transaction (getTransaction, maxSupportedTransactionVersion 0)
 * into { sig, slot, time, rows, rounds, series }. A failed transaction
 * changed nothing and gives { skipped: "failed" }.
 */
export function parseTransaction(tx, programId = PROGRAM_ID) {
  const sig = tx?.transaction?.signatures?.[0];
  if (!tx || !tx.meta) return { sig, skipped: "missing" };
  if (tx.meta.err) return { sig, skipped: "failed" };
  const slot = tx.slot, time = tx.blockTime ?? null;
  const msg = tx.transaction.message;
  const keys = msg.accountKeys.map(keyOf);

  // token balances by account address
  const bal = new Map();
  for (const [side, list] of [["pre", tx.meta.preTokenBalances], ["post", tx.meta.postTokenBalances]]) {
    for (const b of list ?? []) {
      const k = keys[b.accountIndex];
      const e = bal.get(k) ?? { mint: b.mint, owner: b.owner ?? null, decimals: b.uiTokenAmount.decimals, pre: null, post: null };
      e[side] = BigInt(b.uiTokenAmount.amount);
      if (b.owner) e.owner = b.owner;
      bal.set(k, e);
    }
  }
  /** What the account gained (negative: lost) in this transaction; null if no balance was recorded. */
  const delta = (acct) => { const e = bal.get(acct); return e ? (e.post ?? 0n) - (e.pre ?? 0n) : null; };
  const decimalsOf = (acct, mint) => bal.get(acct)?.decimals ?? [...bal.values()].find((e) => e.mint === mint)?.decimals ?? null;

  // our top-level instructions, and how many of them touch each token account
  const ixs = [];
  msg.instructions.forEach((ix, i) => {
    if (ix.programId !== programId || !ix.data) return;
    let data;
    try { data = b58decode(ix.data); } catch { return; }
    const name = IX_BY_DISC.get(Buffer.from(data.subarray(0, 8)).toString("hex"));
    if (name) ixs.push({ i, name, accounts: ix.accounts.map(keyOf) });
  });
  const touches = new Map();
  for (const x of ixs) { const t = ACC[x.name]?.token; if (t !== undefined && x.accounts.length === ACC[x.name].n) { const a = x.accounts[t]; touches.set(a, (touches.get(a) ?? 0) + 1); } }
  /** Base units moved into `dest` by token transfers inside top-level instruction `i`. */
  const inner = (i, dest) => {
    let sum = null;
    for (const g of tx.meta.innerInstructions ?? []) {
      if (g.index !== i) continue;
      for (const x of g.instructions) {
        const p = x.parsed;
        if (!p || (p.type !== "transferChecked" && p.type !== "transfer") || p.info?.destination !== dest) continue;
        sum = (sum ?? 0n) + BigInt(p.info.tokenAmount?.amount ?? p.info.amount ?? 0);
      }
    }
    return sum;
  };
  /** What reached the wallet: its balance change when this is the only one of
   *  our instructions moving that account (exact, the coin's transfer fee
   *  included), else what the program sent it. */
  const received = (x, acct, sent) => {
    const d = delta(acct);
    if (touches.get(acct) === 1 && d !== null) return d > 0n ? d : 0n;
    return sent ?? inner(x.i, acct) ?? 0n;
  };
  /** What left the wallet, by the same rule. */
  const paid = (x, acct, charged) => {
    const d = delta(acct);
    if (touches.get(acct) === 1 && d !== null && d < 0n) return -d;
    return charged;
  };

  const evs = eventsByInstruction(tx.meta.logMessages, programId);
  const rows = [], rounds = {}, series = {};
  const round = (ladder, fields) => { rounds[ladder] = { ...(rounds[ladder] ?? {}), ...fields }; };
  const base = (x, sub = 0) => ({ sig, ix: x.i, sub, slot, time });
  const empty = { lo: null, hi: null, h: null, shares: null, position: null, tranche: null, by: null, amountIn: "0", amountOut: "0", fee: "0" };

  for (const e of evs) {
    const ev = e.event;
    if (ev.name === "SeriesCreated") series[ev.series] = { feedId: ev.feed_id, quoteMint: ev.quote_mint, periodSecs: ev.period_secs, closeSecs: ev.close_secs, clock: ev.clock, createdSig: sig };
    else if (ev.name === "LadderCreated") round(ev.ladder, { series: ev.series, index: ev.index, opensAt: Number(ev.opens_at), locksAt: Number(ev.locks_at), settlesAt: Number(ev.settles_at), creator: ev.creator, createdAt: time, createdSig: sig });
    else if (ev.name === "LadderOpened") round(ev.ladder, { p0: s(ev.p0), expo: ev.exponent, stepBps: ev.step_bps, openedAt: time, openedSig: sig });
    else if (ev.name === "LadderSettled") round(ev.ladder, { settled: { price: s(ev.price), expo: ev.exponent, bin: ev.bin, time, sig, owedToWinners: s(ev.owed_to_winners), lpPool: s(ev.lp_pool) } });
    else if (ev.name === "LadderVoided") round(ev.ladder, { voided: { time, sig, refundable: s(ev.refundable) } });
    else if (ev.name === "LadderClosed") round(ev.ladder, { closed: { time, sig, dust: s(ev.dust) } });
  }

  for (const x of ixs) {
    const a = ACC[x.name];
    if (!a || x.accounts.length !== a.n) continue;
    const acct = (k) => x.accounts[a[k]];
    const mine = evs.filter((e) => e.ix === x.i).map((e) => e.event);
    const ev = (name) => mine.filter((m) => m.name === name);
    const ladder = acct("ladder");
    const mint = a.mint !== undefined ? acct("mint") : null;
    const decimals = a.token !== undefined ? decimalsOf(acct("token"), mint) : null;
    round(ladder, mint ? { quoteMint: mint, ...(decimals !== null ? { decimals } : {}) } : {});
    const row = (fields, sub = 0) => rows.push({ ...base(x, sub), ladder, mint, decimals, ...empty, ...fields });

    switch (x.name) {
      case "ladder_create": {
        const c = ev("LadderCreated")[0];
        if (!c) break;
        row({ wallet: c.creator, kind: "start", tranche: 0, amountIn: s(paid(x, acct("token"), c.seed)) });
        break;
      }
      case "ladder_trade": {
        ev("LadderTraded").forEach((t, n) => {
          const buying = t.shares > 0n;
          const fields = { wallet: t.user, lo: t.lo, hi: t.hi, h: t.h, shares: s(t.shares), fee: s(t.fee), position: acct("position") };
          if (buying) row({ ...fields, kind: "buy", amountIn: s(paid(x, acct("token"), t.amount + t.fee)) }, n);
          else row({ ...fields, kind: "sell", amountOut: s(received(x, acct("token"), t.amount - t.fee)) }, n);
        });
        break;
      }
      case "ladder_lp_join": {
        for (const j of ev("LadderLpJoined")) row({ wallet: j.owner, kind: "deposit", tranche: j.index, amountIn: s(paid(x, acct("token"), j.deposit)) });
        break;
      }
      case "ladder_redeem": {
        const owner = acct("owner"), caller = acct("caller");
        row({ wallet: owner, by: caller !== owner ? caller : null, kind: "redeem", position: acct("position"), amountOut: s(received(x, acct("token"), inner(x.i, acct("token")))) });
        break;
      }
      case "ladder_claim_lp": {
        const owner = acct("owner"), caller = acct("caller");
        const c = ev("LadderLpClaimed")[0];
        const sent = c ? c.principal + c.fees : null;
        row({ wallet: c?.owner ?? owner, by: caller !== owner ? caller : null, kind: "claim", tranche: c ? c.index : null, amountOut: s(received(x, acct("token"), sent)) });
        break;
      }
      case "ladder_collect_fees": {
        const t = acct("token");
        const got = received(x, t, inner(x.i, t));
        const owner = bal.get(t)?.owner;
        if (got > 0n && owner) row({ wallet: owner, kind: "fees", amountOut: s(got) });
        break;
      }
      case "ladder_sweep": {
        const owner = acct("owner"), cranker = acct("cranker");
        row({ wallet: owner, by: cranker !== owner ? cranker : null, kind: "sweep", position: acct("position") });
        break;
      }
      default: break;   // open, settle, void, close: round facts only, from their events
    }
  }
  return { sig, slot, time, rows, rounds, series };
}

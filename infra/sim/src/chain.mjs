// The fleet's reads and its one way to send. Reads are batched
// getMultipleAccountsInfo calls (never getProgramAccounts); every send goes
// through `createSender`, which refuses in plan mode, holds the minute cap,
// prepends the heap frame, and confirms by polling signature statuses in one
// batch for everything in flight (no websockets).

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AccountLayout, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook } from "@sooth/sdk-solana";
import { limitedFetch } from "./rate.mjs";
import { logsOf } from "./classify.mjs";

export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
export const LIVE_FRESH_SECS = 180;

export const hexBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));
export const ataOf = (mint, owner, tokenProgram) => getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
/** The wallet's token account for `mint`, made if missing (paid by `payer`, the owner by default); a no-op otherwise (as the app's `ensureAta`). */
export const ensureAta = (mint, owner, tokenProgram, payer = owner) => createAssociatedTokenAccountIdempotentInstruction(payer, ataOf(mint, owner, tokenProgram), owner, mint, tokenProgram);
export const pythAccount = (feedId) => PublicKey.findProgramAddressSync([Uint8Array.of(0, 0), feedId], PYTH_PUSH_ORACLE)[0];

export function makeConnection(url, bucket) {
  return new Connection(url, { commitment: "confirmed", fetch: limitedFetch(bucket), disableRetryOnRateLimit: true });
}

/** Accounts at `keys`, 100 per request, in order; missing ones are null. */
export async function readAccounts(conn, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await conn.getMultipleAccountsInfo(keys.slice(i, i + 100))));
  return out;
}

/** A PriceUpdateV2 account's price, as the app's `fetchLivePrice` reads it. */
export function parsePythAccount(data, feedId) {
  const d = Buffer.from(data);
  const at = d.indexOf(Buffer.from(feedId));
  if (at < 0) return null;
  return { price: d.readBigInt64LE(at + 32), conf: d.readBigUInt64LE(at + 40), expo: d.readInt32LE(at + 48), publishTime: Number(d.readBigInt64LE(at + 52)) };
}

/** The next day of `s` with a round after the one closing at or before `now`, and the one after it. */
export function todayAndTomorrow(s, now) {
  let today = stook.indexAtOrBefore(s, BigInt(now)) + 1;
  while (!stook.hasRound(s, today)) today++;
  let tomorrow = today + 1;
  while (!stook.hasRound(s, tomorrow)) tomorrow++;
  return { today, tomorrow };
}

/**
 * Reads the fleet's world: for each coin its series, mint (and the transfer
 * fee in force this epoch), today's and tomorrow's rounds, and the push
 * oracle's price. One request per refresh once the series are known.
 */
export function createReader({ conn, coins, siteUrl, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const known = coins.filter((c) => c.mint).map((c) => {
    const feed = hexBytes(c.feedId);
    return { ...c, mintKey: new PublicKey(c.mint), feed, seriesKey: stook.deriveSeries(feed, new PublicKey(c.mint), 0), pythKey: pythAccount(feed) };
  });
  const series = new Map();
  let epoch = null, epochAt = 0;
  const live = new Map();
  let rates = null, ratesAt = 0;

  async function currentEpoch() {
    if (epoch === null || now() - epochAt > 300_000) {
      try { epoch = BigInt((await conn.getEpochInfo()).epoch); epochAt = now(); } catch { /* keep the last */ }
    }
    return epoch ?? undefined;
  }

  async function world() {
    const t = Math.floor(now() / 1000);
    if (known.some((c) => !series.has(c.symbol))) {
      const infos = await readAccounts(conn, known.map((c) => c.seriesKey));
      infos.forEach((a, n) => { if (a) series.set(known[n].symbol, stook.decodeSeries(a.data)); });
    }
    const days = known.map((c) => (series.has(c.symbol) ? todayAndTomorrow(series.get(c.symbol), t) : null));
    const ladderKeys = known.map((c, n) => (days[n] ? [stook.deriveLadderPda({ series: c.seriesKey, index: days[n].today }), stook.deriveLadderPda({ series: c.seriesKey, index: days[n].tomorrow })] : [c.seriesKey, c.seriesKey]));
    const keys = known.flatMap((c, n) => [c.seriesKey, c.mintKey, c.pythKey, ...ladderKeys[n]]);
    const [infos, ep] = await Promise.all([readAccounts(conn, keys), currentEpoch()]);
    const out = [];
    known.forEach((c, n) => {
      const [sA, mA, pA, tA, nA] = infos.slice(n * 5, n * 5 + 5);
      if (sA) series.set(c.symbol, stook.decodeSeries(sA.data));
      const s = series.get(c.symbol) ?? null;
      const round = (a, key, index) => (days[n] && a && a.data.length === stook.LADDER_SIZE ? { key, index, l: stook.decodeLadder(a.data) } : null);
      const report = mA ? stook.classifyMint(new Uint8Array(mA.data), ep) : null;
      const onChain = pA ? parsePythAccount(pA.data, c.feed) : null;
      if (onChain && t - onChain.publishTime < LIVE_FRESH_SECS) live.set(c.symbol, { ...onChain, source: "chain", at: now() });
      out.push({
        ...c,
        series: s,
        tokenProgram: mA?.owner ?? TOKEN_2022_PROGRAM_ID,
        report,
        transferFee: report?.transferFee,
        today: days[n] ? { index: days[n].today, key: ladderKeys[n][0], round: round(tA, ladderKeys[n][0], days[n].today) } : null,
        tomorrow: days[n] ? { index: days[n].tomorrow, key: ladderKeys[n][1], round: round(nA, ladderKeys[n][1], days[n].tomorrow) } : null,
      });
    });
    return { at: t, coins: out };
  }

  /** The live price for a coin's feed: the push oracle when fresh, else the site's /pyth, at most every 10 s per feed. */
  async function livePrice(c) {
    const had = live.get(c.symbol);
    if (had && now() - had.at < 10_000) return had;
    try {
      const r = await fetchImpl(`${siteUrl}/pyth?id=${c.feedId}`);
      if (r.ok) {
        const j = await r.json();
        const p = { price: BigInt(j.price), conf: BigInt(j.conf), expo: Number(j.expo), publishTime: Number(j.publishTime), source: "site", at: now() };
        live.set(c.symbol, p);
        return p;
      }
    } catch { /* keep what we had */ }
    return had && Math.floor(now() / 1000) - had.publishTime < 3600 ? had : null;
  }

  /** Dollars per whole coin from the site's /coins (mainnet prices, as the faucet uses), every 5 minutes. */
  async function usdRates() {
    if (!rates || now() - ratesAt > 300_000) {
      try {
        const r = await fetchImpl(`${siteUrl}/coins`);
        if (r.ok) { const j = await r.json(); rates = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Number(v?.usd ?? v)]).filter(([, v]) => v > 0)); ratesAt = now(); }
      } catch { /* keep the last */ }
    }
    return rates ?? {};
  }

  async function ladder(key) {
    const a = await conn.getAccountInfo(key);
    return a && a.data.length === stook.LADDER_SIZE ? stook.decodeLadder(a.data) : null;
  }

  return { world, livePrice, usdRates, ladder, coins: known };
}

/** SOL and each coin's balance for these wallets, 20 wallets per request. */
export async function readWallets(conn, owners, coins) {
  const per = 1 + coins.length;
  const keys = owners.flatMap((o) => [o, ...coins.map((c) => ataOf(c.mintKey ?? new PublicKey(c.mint), o, c.tokenProgram ?? TOKEN_2022_PROGRAM_ID))]);
  const infos = await readAccounts(conn, keys);
  return owners.map((_o, n) => {
    const row = infos.slice(n * per, n * per + per);
    const coinsOut = {};
    coins.forEach((c, k) => { const a = row[k + 1]; coinsOut[c.symbol] = a ? AccountLayout.decode(a.data.subarray(0, AccountLayout.span)).amount : 0n; });
    return { lamports: BigInt(row[0]?.lamports ?? 0), coins: coinsOut };
  });
}

export class PlanRefusal extends Error {
  constructor(what) { super(`plan mode sends nothing (refused: ${what})`); this.name = "PlanRefusal"; this.notSent = true; }
}

/** The gate said no right before a send: a pause began while the turn waited. */
export class Paused extends Error {
  constructor(why) { super(`paused before sending: ${why}`); this.name = "Paused"; this.notSent = true; }
}

/** A transaction that landed and failed, with the program whose instruction failed. */
function landedError(sig, err, programs) {
  const e = new Error(`transaction failed: ${JSON.stringify(err)}`);
  const at = err?.InstructionError?.[0];
  if (Number.isInteger(at) && programs[at]) e.programId = programs[at];
  e.signature = sig; e.landed = true;
  return e;
}

/**
 * The only way the fleet writes to the chain. `window` is the minute cap;
 * `plan` refuses everything. `gate()` (settable on the returned sender) is
 * asked right before every broadcast, after any wait on the cap, and a
 * reason from it stops the send (`Paused`). Preflight stays on, so most
 * refusals cost no fee and come back with the program's logs.
 *
 * A failed send says what reached the chain: `notSent` (nothing did: plan,
 * the gate, a preflight refusal), `landed` (it landed and failed; the fee is
 * paid) or `maybeSent` (the connection dropped after it went out).
 */
export function createSender({ conn, plan, priority = 50_000, window, gate = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), pollMs = 2_500 }) {
  let hash = null, hashAt = 0;
  const pending = new Map();
  let polling = false;
  const counts = { sent: 0, landed: 0, failed: 0 };
  const self = { send, counts, pending, gate, busy: 0 };

  async function blockhash(fresh = false) {
    if (fresh || !hash || now() - hashAt > 20_000) { hash = await conn.getLatestBlockhash("confirmed"); hashAt = now(); }
    return hash;
  }

  // One poll for everything in flight: a status batch and one block height.
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      while (pending.size) {
        await sleep(pollMs);
        const sigs = [...pending.keys()].slice(0, 256);
        let height, statuses;
        try {
          height = await conn.getBlockHeight("confirmed");
          statuses = (await conn.getSignatureStatuses(sigs, { searchTransactionHistory: true })).value;
        } catch { continue; }
        // No rebroadcast inside a pause: a copy sent now could land in it.
        const quiet = !!self.gate?.(now());
        sigs.forEach((sig, n) => {
          const p = pending.get(sig), st = statuses[n];
          if (!p) return;
          if (st?.err) { pending.delete(sig); p.reject(landedError(sig, st.err, p.programs)); return; }
          if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) { pending.delete(sig); p.resolve(sig); return; }
          if (height > p.lastValid) {
            // Past its blockhash: look once more on the next poll before giving up.
            if (p.expiredPolls++ >= 1) { pending.delete(sig); p.resolve(null); }
            return;
          }
          if (++p.polls % 2 === 0 && !quiet) conn.sendRawTransaction(p.raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
        });
      }
    } finally { polling = false; }
  }

  const confirm = (sig, raw, lastValid, programs) => new Promise((resolve, reject) => {
    pending.set(sig, { resolve, reject, raw, lastValid, programs, polls: 0, expiredPolls: 0 });
    poll();
  });

  /**
   * Sign with `signers` (the first pays), send, and wait until confirmed.
   * With `resign` (the default), a transaction whose blockhash dies unseen
   * is looked for once more and, still absent, signed again once, never
   * sooner than the cap allows. Sends that must not run twice (a buy, a
   * top-up) pass `resign: false` and fail as expired instead.
   */
  async function send(ixs, computeUnits, signers, what = "send", { resign = true } = {}) {
    if (plan) throw new PlanRefusal(what);
    self.busy++;
    try {
      let prior = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        for (let w = window.waitMs(now()); w > 0; w = window.waitMs(now())) await sleep(Math.min(w, 60_000));
        const why = self.gate?.(now());
        if (why) { const e = new Paused(why); if (prior) e.notSent = false; throw e; }
        const tx = new Transaction().add(...stook.withHeap(ixs, computeUnits, priority));
        const programs = tx.instructions.map((ix) => ix.programId.toBase58());
        if (prior) {
          // The first copy may have landed after the last poll: never send it twice.
          const st = (await conn.getSignatureStatuses([prior], { searchTransactionHistory: true })).value[0];
          if (st?.err) { counts.failed++; throw landedError(prior, st.err, programs); }
          if (st) { counts.landed++; return prior; }
        }
        const { blockhash: bh, lastValidBlockHeight } = await blockhash(attempt > 0);
        tx.feePayer = signers[0].publicKey;
        tx.recentBlockhash = bh;
        tx.sign(...signers);
        const raw = tx.serialize();
        window.record(now());
        counts.sent++;
        let sig;
        try {
          sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
        } catch (e) {
          // A blockhash the node has not seen yet: fetch a fresh one and go again.
          if (/Blockhash not found/i.test(e?.message ?? "") && attempt === 0) { hash = null; continue; }
          counts.failed++;
          // Refused at preflight, nothing reached the chain; anything else
          // (a dropped connection) may have gone out.
          const refused = logsOf(e).length > 0 || /simulation failed/i.test(e?.message ?? "");
          if (refused) e.notSent = !prior; else e.maybeSent = true;
          throw e;
        }
        let landed;
        try { landed = await confirm(sig, raw, lastValidBlockHeight, programs); } catch (e) { counts.failed++; throw e; }
        if (landed) { counts.landed++; return sig; }
        if (!resign) break;
        prior = sig;
      }
      counts.failed++;
      throw new Error(`the network did not include the transaction in time${resign ? ", twice" : ""} (expired)`);
    } finally { self.busy--; }
  }

  return self;
}

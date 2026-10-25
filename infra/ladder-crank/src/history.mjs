// Past Pyth prices from chain history, free.
//
// Hermes and Pyth's history service answer only paid keys. But every price
// Pyth's push oracle takes is a transaction anyone can read: the signed
// Wormhole message (VAA), written in chunks to a short-lived account, and the
// update itself, a price message with its Merkle proof against the VAA's
// root. Both stay in the transaction history after the accounts are closed.
// Put back together they are exactly what Hermes would serve for that price
// (an accumulator update, "PNAU"), which the receiver verifies again from
// scratch when it is posted. So nothing here is trusted: a wrong byte fails
// verification on chain.
//
// For a close at `t` this finds the first update the push feed took that
// was published at or after `t` (`oracle::observe_fit` in the program).

import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { utils as anchorUtils } from "@coral-xyz/anchor";

const PUSH_ORACLE = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
const WORMHOLE = "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ";

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const UPDATE_PRICE_FEED = disc("update_price_feed");
const WRITE_ENCODED_VAA = disc("write_encoded_vaa");

/** How far back a series may learn from (`BACKFILL_WINDOW_SECS`), plus a day. */
const KEEP_SECS = 46 * 86_400;
/**
 * How many transactions after the close to read for its update, and how many
 * at a time. Most transactions naming a busy feed's account only read it
 * (devnet BTC is read every few seconds and pushed every five minutes).
 */
const LOOK_AHEAD = 120;
const BATCH = 4;

export const pushFeedAddress = (feedHex) => PublicKey.findProgramAddressSync([Buffer.from([0, 0]), Buffer.from(feedHex, "hex")], new PublicKey(PUSH_ORACLE))[0];

/**
 * A transaction as `{ ixs: [{ program, accounts, data }] }`, its own
 * instructions and the ones they called (devnet's pusher reaches the push
 * oracle through a program of its own). Asked for as JSON, which the node renders for every
 * transaction version (devnet already carries version 1, which web3.js 1.x
 * cannot decode).
 */
export async function readTx(connection, signature) {
  // Free RPCs answer 429 to bursts of this call: back off and ask again.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await connection._rpcRequest("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      if (r.error) throw new Error(`getTransaction: ${r.error.message}`);
      return r.result ? normalTx(r.result) : null;
    } catch (e) {
      if (attempt >= 5 || !/429|Too Many/i.test(String(e?.message ?? e))) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

export function normalTx(t) {
  const keys = [...t.transaction.message.accountKeys, ...(t.meta?.loadedAddresses?.writable ?? []), ...(t.meta?.loadedAddresses?.readonly ?? [])];
  const one = (ix) => ({ program: keys[ix.programIdIndex], accounts: ix.accounts.map((i) => keys[i]), data: Buffer.from(anchorUtils.bytes.bs58.decode(ix.data)) });
  return { ixs: [...t.transaction.message.instructions, ...(t.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)].map(one) };
}

/** A Pyth price message (`PriceFeedMessage`), big-endian after its type byte. */
export function parsePriceMessage(m) {
  if (m[0] !== 0 || m.length < 1 + 32 + 8 + 8 + 4 + 8 + 8) return null;
  let o = 1;
  const id = m.subarray(o, o + 32).toString("hex"); o += 32;
  const price = m.readBigInt64BE(o); o += 8;
  const conf = m.readBigUInt64BE(o); o += 8;
  const expo = m.readInt32BE(o); o += 4;
  const publish = m.readBigInt64BE(o); o += 8;
  const prev = m.readBigInt64BE(o);
  return { id, price: { price: String(price), conf: String(conf), expo, publish_time: Number(publish) }, metadata: { prev_publish_time: Number(prev) } };
}

/**
 * The push oracle's `update_price_feed` calls in a transaction: for each, the
 * price message, its proof, the feed and the encoded-VAA account it read.
 */
export function pushUpdatesIn(tx) {
  const out = [];
  for (const ix of tx.ixs) {
    if (ix.program !== PUSH_ORACLE) continue;
    const d = ix.data;
    if (!d.subarray(0, 8).equals(UPDATE_PRICE_FEED)) continue;
    let o = 8;
    const ml = d.readUInt32LE(o); o += 4;
    const message = d.subarray(o, o + ml); o += ml;
    const n = d.readUInt32LE(o); o += 4;
    const proof = [];
    for (let i = 0; i < n; i++, o += 20) proof.push(d.subarray(o, o + 20));
    o += 1 + 2; // treasury id, shard id
    const feed = d.subarray(o, o + 32).toString("hex");
    out.push({ feed, message, proof, vaaAccount: ix.accounts[2] });
  }
  return out;
}

/** The VAA the Wormhole receiver was given for `vaaAccount`, from the `write_encoded_vaa` calls in `txs`. */
export function vaaFrom(txs, vaaAccount) {
  const chunks = [];
  for (const tx of txs) {
    for (const ix of tx.ixs) {
      if (ix.program !== WORMHOLE || ix.accounts[1] !== vaaAccount) continue;
      const d = ix.data;
      if (!d.subarray(0, 8).equals(WRITE_ENCODED_VAA)) continue;
      const index = d.readUInt32LE(8), len = d.readUInt32LE(12);
      chunks.push([index, d.subarray(16, 16 + len)]);
    }
  }
  if (!chunks.length) return null;
  const size = Math.max(...chunks.map(([i, b]) => i + b.length));
  const vaa = Buffer.alloc(size);
  for (const [i, b] of chunks) b.copy(vaa, i);
  return vaa;
}

/** An accumulator update as Hermes serves it: one VAA, one price message with its proof. */
export function accumulatorUpdate(vaa, message, proof) {
  const vlen = Buffer.alloc(2); vlen.writeUInt16BE(vaa.length);
  const mlen = Buffer.alloc(2); mlen.writeUInt16BE(message.length);
  return Buffer.concat([Buffer.from("PNAU"), Buffer.from([1, 0, 0, 0]), vlen, vaa, Buffer.from([1]), mlen, message, Buffer.from([proof.length]), ...proof]);
}

/**
 * A price source in Hermes' shape (`fetchUpdate(path, feedHex)`) that answers
 * `/v2/updates/price/<t>` from chain history: `parsed` marked `rebuilt`, and
 * the update to post in `vaas.rebuilt` (posted fully verified: it carries
 * all of its few signatures). Signatures of each push-feed account are kept
 * in memory, newest first, back as far as a series may learn from.
 */
export function historyPrices(connection, { now = () => Math.floor(Date.now() / 1000) } = {}) {
  const books = new Map(); // feed → { sigs: [{ signature, blockTime }] newest first, done }

  async function signaturesSince(feedHex, t) {
    const address = pushFeedAddress(feedHex);
    const book = books.get(feedHex) ?? { sigs: [], done: false };
    books.set(feedHex, book);
    // Newer ones first, down to what the book already holds.
    const fresh = [];
    for (let before; book.sigs.length;) {
      const page = await connection.getSignaturesForAddress(address, { before, until: book.sigs[0]?.signature, limit: 1000 });
      fresh.push(...page.filter((s) => !s.err && s.blockTime));
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    book.sigs.unshift(...fresh);
    // Then older ones, until the book reaches back before `t`.
    while (!book.done && (book.sigs.at(-1)?.blockTime ?? Infinity) >= t) {
      const page = await connection.getSignaturesForAddress(address, { before: book.sigs.at(-1)?.signature, limit: 1000 });
      book.sigs.push(...page.filter((s) => !s.err && s.blockTime));
      if (page.length < 1000) book.done = true;
    }
    const cut = now() - KEEP_SECS;
    while (book.sigs.length && book.sigs.at(-1).blockTime < cut) { book.sigs.pop(); book.done = false; }
    // The update for `t` landed at or after it (a few seconds of clock skew allowed).
    return book.sigs.filter((s) => s.blockTime >= t - 10).reverse();
  }

  return async (path, feedHex) => {
    const t = Number(path.match(/\/(\d+)$/)?.[1]);
    if (!Number.isFinite(t)) throw new Error(`history: no time in ${path}`);
    const after = await signaturesSince(feedHex, t);
    let best = null;
    for (let i = 0; i < Math.min(after.length, LOOK_AHEAD) && !best; i += BATCH) {
      const txs = await Promise.all(after.slice(i, i + BATCH).map((x) => readTx(connection, x.signature)));
      for (const tx of txs) {
        for (const u of tx ? pushUpdatesIn(tx) : []) {
          if (u.feed !== feedHex) continue;
          const parsed = parsePriceMessage(u.message);
          if (!parsed || parsed.price.publish_time < t) continue;
          if (!best || parsed.price.publish_time < best.parsed.price.publish_time) best = { ...u, parsed };
        }
      }
    }
    if (!best) return { parsed: undefined, vaas: {} };
    const writes = await connection.getSignaturesForAddress(new PublicKey(best.vaaAccount), { limit: 50 });
    const txs = [];
    for (const w of writes) { const tx = await readTx(connection, w.signature); if (tx) txs.push(tx); }
    const vaa = vaaFrom(txs, best.vaaAccount);
    if (!vaa) return { parsed: undefined, vaas: {} };
    return { parsed: { ...best.parsed, rebuilt: true }, vaas: { rebuilt: [accumulatorUpdate(vaa, best.message, best.proof).toString("base64")] } };
  };
}

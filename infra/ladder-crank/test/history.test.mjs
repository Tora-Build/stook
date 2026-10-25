import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { historyPrices, normalTx, pushFeedAddress, pushUpdatesIn, vaaFrom, accumulatorUpdate } from "../src/history.mjs";

// A real ZEC/USD push update on mainnet and the Wormhole writes of its VAA,
// read on 2026-10-25 (`getTransaction`, JSON encoding).
const fx = JSON.parse(readFileSync(new URL("./fixtures/zec-mainnet.json", import.meta.url), "utf8"));

const require = createRequire(import.meta.url);
const receiverDir = dirname(require.resolve("@pythnetwork/pyth-solana-receiver"));
const pss = require(require.resolve("@pythnetwork/price-service-sdk", { paths: [receiverDir] }));
const web3Dir = dirname(require.resolve("@solana/web3.js"));
const { keccak_256 } = require(require.resolve("@noble/hashes/sha3", { paths: [web3Dir] }));

/** The Merkle root a price message and its proof lead to, as the receiver computes it. */
function rootOf(message, proof) {
  let h = Buffer.from(keccak_256(Buffer.concat([Buffer.from([0]), message]))).subarray(0, 20);
  for (const p of proof) {
    const [a, b] = Buffer.compare(h, p) < 0 ? [h, p] : [p, h];
    h = Buffer.from(keccak_256(Buffer.concat([Buffer.from([1]), a, b]))).subarray(0, 20);
  }
  return h;
}

/** The root a Pyth accumulator VAA signs: the last 20 bytes of its AUWV payload, after the signatures and the 51-byte body header. */
function signedRoot(vaa) {
  const payload = vaa.subarray(6 + 66 * vaa[5] + 51);
  assert.equal(payload.subarray(0, 4).toString(), "AUWV");
  return payload.subarray(-20);
}

test("a push update rebuilt from its transactions is the update Pyth signed", () => {
  const [u] = pushUpdatesIn(normalTx(fx.update.tx)).filter((x) => x.feed === fx.feed);
  assert.ok(u, "the update names the feed");
  assert.equal(u.vaaAccount, fx.vaaAccount);
  const vaa = vaaFrom(fx.writes.map((w) => normalTx(w.tx)), u.vaaAccount);
  assert.equal(vaa[0], 1, "a version-1 VAA");
  assert.deepEqual(rootOf(u.message, u.proof), signedRoot(vaa), "the message's proof reaches the root the guardians signed");

  const back = pss.parseAccumulatorUpdateData(accumulatorUpdate(vaa, u.message, u.proof));
  assert.deepEqual(Buffer.from(back.vaa), vaa);
  assert.equal(back.updates.length, 1);
  const m = pss.parsePriceFeedMessage(back.updates[0].message);
  assert.equal(m.feedId.toString("hex"), fx.feed);
});

test("history answers a close with the first update published at or after it", async () => {
  const [u] = pushUpdatesIn(normalTx(fx.update.tx)).filter((x) => x.feed === fx.feed);
  const publish = Number(pss.parsePriceFeedMessage(u.message).publishTime);
  const pda = pushFeedAddress(fx.feed).toBase58();
  // The feed's account: a reader's transaction after the update, the update, one from before the close.
  const reader = { signature: "reader", blockTime: fx.update.blockTime + 5, err: null };
  const sigs = { [pda]: [reader, { signature: fx.update.signature, blockTime: fx.update.blockTime, err: null }, { signature: "old", blockTime: publish - 3600, err: null }], [fx.vaaAccount]: fx.writes.map((w) => ({ signature: w.signature, err: null })) };
  const txs = { [fx.update.signature]: fx.update.tx, reader: { transaction: { message: { accountKeys: [pda], instructions: [] } }, meta: {} }, ...Object.fromEntries(fx.writes.map((w) => [w.signature, w.tx])) };
  const calls = [];
  const connection = {
    getSignaturesForAddress: async (a, o) => { calls.push(o); const all = sigs[a.toBase58()] ?? []; const from = o.before ? all.findIndex((s) => s.signature === o.before) + 1 : 0; return all.slice(from, from + o.limit); },
    _rpcRequest: async (_m, [sig]) => ({ result: txs[sig] ?? null }),
  };
  const h = historyPrices(connection, { now: () => publish + 60 });
  const r = await h(`/v2/updates/price/${publish - 2}`, fx.feed);
  assert.equal(r.parsed.rebuilt, true);
  assert.equal(r.parsed.price.publish_time, publish);
  assert.ok(r.parsed.metadata.prev_publish_time < publish, "a Pythnet tick before it");
  assert.equal(pss.parseAccumulatorUpdateData(Buffer.from(r.vaas.rebuilt[0], "base64")).updates.length, 1);

  // Nothing published after this close yet: no update, nothing to post.
  const none = await h(`/v2/updates/price/${publish + 1}`, fx.feed);
  assert.equal(none.parsed, undefined);
});

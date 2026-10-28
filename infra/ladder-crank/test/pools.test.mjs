// The keeper's pool source (src/pools.mjs) on mainnet's Polymarket PreStocks
// pool and observation accounts, byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { poolPrices, routed } from "../src/pools.mjs";

const FIX = new URL("../../../packages/programs-core/programs/sooth-core/tests-fixtures/", import.meta.url);
const POOL = new PublicKey("5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs");
const OBS = new PublicKey("AcPAWXqHfqLDujqkG6BNEFJPijHxMHxdz5tz4KcR4t7z");
const accounts = new Map([
  [POOL.toBase58(), { owner: stook.RAYDIUM_CLMM, data: readFileSync(new URL("polymarket-pool.bin", FIX)) }],
  [OBS.toBase58(), { owner: stook.RAYDIUM_CLMM, data: readFileSync(new URL("polymarket-observation.bin", FIX)) }],
]);
const connection = { getAccountInfo: async (k) => accounts.get(k.toBase58()) ?? null };
const feed = Buffer.from(POOL.toBytes()).toString("hex");
const NEWEST = 1_793_223_578;

test("a pool feed is priced from its pool, as the program will", async () => {
  const pools = poolPrices(connection);
  assert.equal(await pools.isPool(feed), true);
  assert.equal(await pools.isPool("ef".repeat(32)), false);
  const { parsed, vaas } = await pools.price(feed, NEWEST);
  assert.equal(parsed.price.price, "14228794306");
  assert.deepEqual([parsed.price.expo, parsed.price.publish_time, parsed.metadata.prev_publish_time, parsed.pool], [-8, NEWEST, NEWEST - 1, true]);
  assert.ok(vaas.pool.equals(POOL) && vaas.observation.equals(OBS));
  // A settlement time past the newest entry has no price yet.
  assert.equal((await pools.price(feed, NEWEST + 1)).parsed, undefined);
  // A late open takes the latest entry.
  assert.equal((await pools.price(feed, NEWEST + 600, true)).parsed.price.publish_time, NEWEST);
  // The SDK's checks take it as THE price for its instant.
  assert.equal(stook.settlementProblem(parsed, { feedId: POOL.toBytes(), settlesAt: BigInt(NEWEST), stepBps: 50, p0Expo: -8 }), null);
});

test("routed sends pool feeds to the pool and the rest on", async () => {
  const seen = [];
  const fetch = routed(poolPrices(connection), async (path, f) => { seen.push(f); return { parsed: undefined, vaas: null }; });
  assert.equal((await fetch(`/v2/updates/price/${NEWEST}`, feed)).parsed.pool, true);
  await fetch(`/v2/updates/price/${NEWEST}`, "ef".repeat(32));
  assert.deepEqual(seen, ["ef".repeat(32)]);
});

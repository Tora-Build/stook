import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRpc, RpcError, tokenBucket } from "../src/rpc.mjs";

/** A clock that only moves when someone sleeps. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, at: () => t };
}

test("the bucket holds a steady rate after its burst", async () => {
  const c = fakeClock();
  const take = tokenBucket({ rps: 3, burst: 3, now: c.now, sleep: c.sleep });
  for (let i = 0; i < 3; i++) await take();
  assert.equal(c.at(), 0, "the burst is free");
  for (let i = 0; i < 9; i++) await take();
  assert.ok(c.at() >= 2990 && c.at() <= 3100, `9 more at 3/s take 3 s, took ${c.at()} ms`);
});

const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });

test("429 and 5xx back off exponentially, then succeed", async () => {
  const c = fakeClock();
  const seq = [reply(429, {}), reply(503, {}), reply(200, { jsonrpc: "2.0", error: { code: 429, message: "slow down" } }), reply(200, { jsonrpc: "2.0", result: 42 })];
  const waits = [];
  const rpc = makeRpc({ url: "x", rps: 1000, now: c.now, sleep: async (ms) => { waits.push(ms); await c.sleep(ms); }, fetchImpl: async () => seq.shift() });
  assert.equal(await rpc.call("getSlot", []), 42);
  const backs = waits.filter((w) => w >= 500);
  assert.equal(backs.length, 3);
  assert.ok(backs[1] > backs[0] && backs[2] > backs[1], `growing: ${backs}`);
  assert.equal(rpc.stats().calls.getSlot, 4);
  assert.equal(rpc.stats().backoffs, 3);
});

test("Retry-After is honoured", async () => {
  const c = fakeClock();
  const waits = [];
  const seq = [reply(429, {}, { "retry-after": "7" }), reply(200, { result: 1 })];
  const rpc = makeRpc({ url: "x", rps: 1000, now: c.now, sleep: async (ms) => { waits.push(ms); await c.sleep(ms); }, fetchImpl: async () => seq.shift() });
  await rpc.call("getSlot", []);
  assert.ok(waits.some((w) => w >= 5600 && w <= 8400), `waited ${waits}`);
});

test("a real error is not retried; a dead endpoint gives up", async () => {
  const c = fakeClock();
  let n = 0;
  const bad = makeRpc({ url: "x", rps: 1000, now: c.now, sleep: c.sleep, fetchImpl: async () => { n++; return reply(200, { error: { code: -32602, message: "invalid params" } }); } });
  await assert.rejects(bad.call("getTransaction", []), (e) => e instanceof RpcError && /invalid params/.test(e.message));
  assert.equal(n, 1);
  const dead = makeRpc({ url: "x", rps: 1000, now: c.now, sleep: c.sleep, maxTries: 3, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  await assert.rejects(dead.call("getSlot", []), /gave up after 3 tries/);
});

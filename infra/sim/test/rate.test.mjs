// The minute cap on sends and the RPC bucket's back-off on 429.
import { test } from "node:test";
import assert from "node:assert/strict";
import { limitedFetch, RpcBucket, TxWindow } from "../src/rate.mjs";

test("at most the cap in any sliding minute", () => {
  const w = new TxWindow(4);
  let t = 0;
  for (let n = 0; n < 4; n++) { assert.equal(w.waitMs(t), 0); w.record(t); t += 1000; }
  assert.equal(w.waitMs(t), 60_000 - t);
  assert.equal(w.waitMs(60_000), 0);
  // Simulate an hour of eager sending: never more than 4 in any 60 s.
  const sent = [];
  const w2 = new TxWindow(4);
  for (let now = 0; now < 3_600_000; now += 250) if (w2.waitMs(now) === 0) { w2.record(now); sent.push(now); }
  for (let i = 4; i < sent.length; i++) assert.ok(sent[i] - sent[i - 4] >= 60_000);
  assert.equal(sent.length, 240);
  assert.equal(new TxWindow(0).waitMs(0), Infinity);
});

test("the bucket paces requests and stops whole on 429", async () => {
  let clock = 0;
  const b = new RpcBucket(2, { burst: 2, now: () => clock, sleep: async (ms) => { clock += ms; } });
  for (let n = 0; n < 10; n++) await b.take();
  // 2 burst, then 2 a second: 8 more take 4 s.
  assert.ok(clock >= 4000 && clock < 4600, `took ${clock}`);
  let calls = 0;
  const f = limitedFetch(b, { fetchImpl: async () => ({ status: ++calls <= 2 ? 429 : 200 }) });
  const before = clock;
  const res = await f("x");
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
  // Backed off 2 s then 4 s before the third try.
  assert.ok(clock - before >= 6000, `waited ${clock - before}`);
  assert.equal(b.limited, 2);
  // Gives up after `tries`, returning the 429.
  const g = limitedFetch(b, { tries: 2, fetchImpl: async () => ({ status: 429 }) });
  assert.equal((await g("x")).status, 429);
});

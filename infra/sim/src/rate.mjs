// The two limits the fleet lives under: at most `txPerMin` transactions in
// any minute, and a steady trickle of RPC requests that backs off whole when
// the endpoint answers 429. The keeper shares the box, and often the RPC.

/** At most `cap` sends in any sliding minute. */
export class TxWindow {
  constructor(cap, span = 60_000) { this.cap = cap; this.span = span; this.times = []; }
  #trim(now) { while (this.times.length && this.times[0] <= now - this.span) this.times.shift(); }
  /** How long to wait before the next send may go, ms (0: now). */
  waitMs(now = Date.now()) {
    this.#trim(now);
    if (this.cap <= 0) return Infinity;
    return this.times.length < this.cap ? 0 : this.times[0] + this.span - now;
  }
  record(now = Date.now()) { this.#trim(now); this.times.push(now); }
  count(now = Date.now()) { this.#trim(now); return this.times.length; }
}

/**
 * A token bucket for RPC requests, `perSec` sustained with a burst of
 * `burst`. `pause(ms)` stops it whole (a 429), and doubling pauses on
 * repeated 429s grow to `maxBackoff`.
 */
export class RpcBucket {
  constructor(perSec, { burst = Math.max(1, Math.ceil(perSec * 2)), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxBackoff = 60_000 } = {}) {
    if (!(perSec > 0)) throw new Error("the RPC bucket needs a rate above 0");
    this.perSec = perSec; this.burst = burst; this.tokens = burst; this.at = now();
    this.now = now; this.sleep = sleep; this.until = 0; this.backoff = 0; this.maxBackoff = maxBackoff;
    this.requests = 0; this.limited = 0;
  }
  #refill() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.perSec);
    this.at = t;
  }
  /** Resolves when one request may go. */
  async take() {
    for (;;) {
      const t = this.now();
      if (t < this.until) { await this.sleep(this.until - t); continue; }
      this.#refill();
      if (this.tokens >= 1) { this.tokens -= 1; this.requests++; return; }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.perSec) * 1000));
    }
  }
  /** The endpoint said 429: stop everything for a while, longer each time in a row. */
  limitedNow() {
    this.limited++;
    this.backoff = Math.min(this.maxBackoff, this.backoff ? this.backoff * 2 : 2_000);
    this.until = this.now() + this.backoff;
    this.tokens = 0;
  }
  ok() { this.backoff = 0; }
}

/**
 * `fetch` for web3.js's Connection that waits on the bucket before every
 * request and, on a 429, pauses the bucket and tries again (up to `tries`),
 * so no request goes faster than the bucket allows.
 */
export function limitedFetch(bucket, { tries = 4, fetchImpl = globalThis.fetch } = {}) {
  return async (input, init) => {
    for (let n = 0; ; n++) {
      await bucket.take();
      const res = await fetchImpl(input, init);
      if (res.status !== 429) { bucket.ok(); return res; }
      bucket.limitedNow();
      if (n + 1 >= tries) return res;
    }
  };
}

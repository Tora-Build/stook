// JSON-RPC to Solana under a token bucket (a steady `rps`, bursts of `burst`)
// with exponential backoff on 429, 5xx and network errors. Every call is
// counted per method, for /health and the daily budget.

export function tokenBucket({ rps, burst = Math.max(1, rps), now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let tokens = burst, at = now();
  let chain = Promise.resolve();
  const take = async () => {
    for (;;) {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - at) / 1000) * rps);
      at = t;
      if (tokens >= 1) { tokens -= 1; return; }
      await sleep(Math.ceil(((1 - tokens) / rps) * 1000));
    }
  };
  // one waiter at a time, so callers are served in order
  return () => (chain = chain.then(take));
}

export class RpcError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** Retry-worthy: rate limits, server errors, timeouts and dropped connections. */
const transient = (status, code) => status === 429 || status >= 500 || code === 429 || code === -32005 || code === -32007 || code === -32014;

export function makeRpc({ url, rps = 3, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), maxTries = 8, baseMs = 1000, maxMs = 60_000, log = () => {} }) {
  const take = tokenBucket({ rps, now, sleep });
  const calls = {};
  let errors = 0, backoffs = 0, id = 0;
  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      await take();
      calls[method] = (calls[method] ?? 0) + 1;
      let status = 0, code = null, retryAfter = null, msg;
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(30_000) });
        status = r.status;
        retryAfter = Number(r.headers?.get?.("retry-after")) || null;
        if (r.ok) {
          const j = await r.json();
          if (!j.error) return j.result;
          code = j.error.code; msg = `${method}: ${j.error.message}`;
          if (!transient(0, code)) throw new RpcError(msg, code);
        } else msg = `${method}: HTTP ${status}`;
        if (!transient(status, code)) throw new RpcError(msg, status);
      } catch (e) {
        if (e instanceof RpcError) { errors++; throw e; }
        msg ??= `${method}: ${e.message}`;
      }
      errors++;
      if (attempt + 1 >= maxTries) throw new RpcError(`${msg} (gave up after ${maxTries} tries)`, code ?? status);
      const wait = Math.min(maxMs, retryAfter ? retryAfter * 1000 : baseMs * 2 ** attempt) * (0.8 + Math.random() * 0.4);
      backoffs++;
      log(`rpc: ${msg}, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  return { call, stats: () => ({ calls: { ...calls }, errors, backoffs }) };
}

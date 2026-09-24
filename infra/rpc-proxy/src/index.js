// JSON-RPC pass-through so the browser bundle never carries the RPC key.
//
// The site calls this Worker; the Worker calls the real endpoint with the
// key held server-side as a secret. Only JSON-RPC POSTs and the CORS
// preflight are served — anything else is refused, so the proxy cannot be
// used to reach arbitrary paths on the upstream host.

// What the apps, scripts and the keeper call (getProgramAccounts is listed
// for old clients; the upstream's free tier refuses it anyway). Anything else
// is refused, so the key's quota is spent on what the apps do.
const METHODS = new Set([
  "getAccountInfo", "getMultipleAccounts", "getBalance", "getLatestBlockhash", "isBlockhashValid",
  "sendTransaction", "simulateTransaction", "getSignatureStatuses", "getTransaction",
  "getSignaturesForAddress", "getTokenAccountBalance", "getTokenAccountsByOwner", "getTokenSupply",
  "getMinimumBalanceForRentExemption", "getFeeForMessage", "getRecentPrioritizationFees",
  "getSlot", "getBlockHeight", "getBlockTime", "getTokenLargestAccounts", "getProgramAccounts", "getEpochInfo", "getVersion", "getGenesisHash", "getHealth", "requestAirdrop",
]);
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 20;

const deny = (msg, status) => new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: msg } }), { status, headers: { "content-type": "application/json", ...CORS } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, solana-client",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return new Response("POST JSON-RPC only", { status: 405, headers: CORS });
    }
    // One address may not spend the quota for everyone.
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "anon" });
      if (!success) return deny("rate limited", 429);
    }
    const text = await request.text();
    if (text.length > MAX_BODY) return deny("request too large", 413);
    let calls;
    try { calls = JSON.parse(text); } catch { return deny("not JSON", 400); }
    const list = Array.isArray(calls) ? calls : [calls];
    if (list.length === 0 || list.length > MAX_BATCH) return deny("batch size", 400);
    for (const c of list) if (!c || typeof c.method !== "string" || !METHODS.has(c.method)) return deny(`method not served: ${String(c?.method).slice(0, 40)}`, 403);
    const upstream = await fetch(env.UPSTREAM_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json", ...CORS },
    });
  },
};

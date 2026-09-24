// stooks.xyz: static assets, plus two small data routes the page and the app
// read. Market data for display comes from public sources (Yahoo, CoinGecko,
// GeckoTerminal); settlement on chain is Pyth and only Pyth. Cached at the
// edge so the sources see one request a minute, not one per visitor.
const COINS = {
  STOOK: { kind: "yahoo", symbol: "SPY" },
  ZCAT: { kind: "yahoo", symbol: "ZEC-USD" },   // CoinGecko rate-limits Cloudflare egress; Yahoo carries ZEC 24/7
  // STONK trades on a Raydium CLMM pool against SPYx. The pool's state is read
  // straight from the chain (no aggregator, no rate limit) and priced in
  // dollars through SPY. No intraday series for it: the pool's own history
  // buffer is minutes long, and the aggregators that keep one throttle
  // Cloudflare's shared addresses.
  KNOTS: { kind: "raydium-clmm", pool: "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49", quoteSymbol: "SPY", quoteDecimals: 8, baseDecimals: 9 },
  GP: { kind: "yahoo", symbol: "GLD" },
};
const UA = { "user-agent": "Mozilla/5.0 stook-street", accept: "application/json" };

// Each coin's own mint on mainnet, for its dollar price (Jupiter). The app
// shows what a trade costs and pays in dollars as well as in the coin.
const BASE_MINTS = {
  ZCAT: "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR",
  KNOTS: "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS",
  GP: "HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ",
};

/** Jupiter's price API for the coins: { STOOK: { usd, change24h }, … }; a coin it lacks is left out. */
async function coinQuotes(env) {
  // $STOOK's mint is a Worker setting (STOOK_MINT), not in the repo.
  const MINTS = { ...BASE_MINTS, ...(env.STOOK_MINT ? { STOOK: env.STOOK_MINT } : {}) };
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${Object.values(MINTS).join(",")}`, { headers: UA });
  if (!r.ok) throw new Error(`jupiter ${r.status}`);
  const j = await r.json();
  const out = {};
  for (const [sym, mint] of Object.entries(MINTS)) {
    const q = j?.[mint], p = q?.usdPrice;
    if (typeof p === "number" && p > 0) out[sym] = { usd: p, change24h: typeof q.priceChange24h === "number" ? q.priceChange24h : null };
  }
  return out;
}

const RPC = "https://solana-rpc.publicnode.com";

/** A Raydium CLMM pool's spot price of token1 in token0, from sqrt_price_x64. */
async function clmmPrice(pool, dec0, dec1) {
  const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [pool, { encoding: "base64" }] }) })).json();
  const d = Uint8Array.from(atob(j.result.value.data[0]), (c) => c.charCodeAt(0));
  const o = 8 + 1 + 32 * 7 + 2 + 2 + 16;                       // …tick_spacing, liquidity, then sqrt_price_x64
  const dv = new DataView(d.buffer);
  const sqrt = Number(dv.getBigUint64(o, true)) + Number(dv.getBigUint64(o + 8, true)) * 2 ** 64;
  const p = sqrt / 2 ** 64;
  return p * p * 10 ** (dec0 - dec1);                          // token1 per token0
}

/** [ [unix seconds, price], … ] over roughly the last day, oldest first. */
async function series(src) {
  if (src.kind === "raydium-clmm") {
    const [perQuote, quote] = await Promise.all([clmmPrice(src.pool, src.quoteDecimals, src.baseDecimals), series({ kind: "yahoo", symbol: src.quoteSymbol })]);
    const q = quote[quote.length - 1];
    if (!q) return [];
    const point = [Math.floor(Date.now() / 1000), q[1] / perQuote];
    // Keep our own day of history: one point per five minutes in KV.
    if (!src.kv) return [point];
    const key = `series:${src.key}`;
    let pts = (await src.kv.get(key, "json")) || [];
    const dayAgo = point[0] - 86_400;
    pts = pts.filter((p) => p[0] >= dayAgo);
    if (!pts.length || point[0] - pts[pts.length - 1][0] >= 300) { pts.push(point); await src.kv.put(key, JSON.stringify(pts)); }
    else pts[pts.length - 1] = point;
    return pts;
  }
  if (src.kind === "yahoo") {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${src.symbol}?range=1d&interval=5m`, { headers: UA })).json();
    const r = j.chart.result[0]; const close = r.indicators.quote[0].close;
    return r.timestamp.map((t, i) => [t, close[i]]).filter((p) => p[1] != null);
  }
  if (src.kind === "coingecko") {
    const j = await (await fetch(`https://api.coingecko.com/api/v3/coins/${src.id}/market_chart?vs_currency=usd&days=1`, { headers: UA })).json();
    return j.prices.map(([ms, p]) => [Math.floor(ms / 1000), p]);
  }
  if (src.kind === "geckoterminal") {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${src.pool}/ohlcv/minute?aggregate=15&limit=96`, { headers: UA });
    const j = await r.json();
    if (!j.data) throw new Error(`geckoterminal ${r.status}: ${JSON.stringify(j).slice(0, 80)}`);
    return j.data.attributes.ohlcv_list.map(([t, , , , close]) => [t, close]).reverse();
  }
  return [];
}

/** The tape's current public address (a quick tunnel, re-announced when it restarts). */
async function tapeUrl(env) { return env.SERIES.get("tape:url"); }

/** Ask the tape; null if it is down or slow. */
async function fromTape(env, path) {
  const base = await tapeUrl(env); if (!base) return null;
  try { const r = await fetch(base + path, { signal: AbortSignal.timeout(2500) }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // The tape announces where it is.
    if (url.pathname === "/tape/register" && request.method === "POST") {
      if (!env.TAPE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.TAPE_TOKEN}`) return new Response("no", { status: 401 });
      const { url: u } = await request.json(); if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(u)) return new Response("bad url", { status: 400 });
      await env.SERIES.put("tape:url", u); return new Response("ok");
    }
    // Live stream and candles straight from the tape (no cache). Only known
    // coins and plain numbers go through, and what comes back is served as
    // the type it must be, whatever the tape says.
    if (url.pathname === "/tape/stream" || url.pathname === "/tape/candles") {
      const base = await tapeUrl(env); if (!base) return new Response("tape offline", { status: 503 });
      if (url.pathname === "/tape/stream") {
        const r = await fetch(base + "/stream", { headers: { accept: "text/event-stream" } });
        return new Response(r.body, { status: r.status, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
      }
      const coin = url.searchParams.get("coin"), q = new URLSearchParams({ coin: coin ?? "" });
      if (!coin || !Object.hasOwn(COINS, coin)) return new Response("unknown coin", { status: 404 });
      for (const k of ["res", "from"]) { const v = url.searchParams.get(k); if (v !== null) { if (!/^\d{1,12}$/.test(v)) return new Response(`bad ${k}`, { status: 400 }); q.set(k, v); } }
      const r = await fetch(`${base}/candles?${q}`);
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "x-content-type-options": "nosniff" } });
    }
    // /supply: $STOOK's circulating supply, for aggregators (Jupiter asks for
    // {"circulatingSupply": number} on the team's domain). Read from chain:
    // the mint's supply, less the token accounts listed in the STOOK_EXCLUDE
    // setting (comma-separated, e.g. locked or team tokens).
    // The mint is the STOOK_MINT setting, so neither is in the repo.
    if (url.pathname === "/supply") {
      const cache = caches.default, key = new Request(url.origin + "/supply");
      const hit = await cache.match(key); if (hit) return hit;
      if (!env.STOOK_MINT) return new Response(JSON.stringify({ error: "mint not configured" }), { status: 503, headers: { "content-type": "application/json" } });
      // Plain account reads: the public endpoints refuse token-index calls
      // from Cloudflare, but any node serves getAccountInfo.
      const account = async (key) => {
        const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [key, { encoding: "base64" }] }) })).json();
        if (j.error || !j.result?.value) throw new Error(`account ${key.slice(0, 6)}: ${j.error?.message ?? "not found"}`);
        return Uint8Array.from(atob(j.result.value.data[0]), (c) => c.charCodeAt(0));
      };
      const u64 = (d, o) => new DataView(d.buffer).getBigUint64(o, true);
      let body, status = 200;
      try {
        // SPL and Token-2022 mints share the base layout: supply at 36, decimals at 44
        const mint = await account(env.STOOK_MINT);
        const decimals = mint[44];
        let units = u64(mint, 36);
        // excluded token accounts (not owners): their balance sits at 64
        for (const w of (env.STOOK_EXCLUDE ?? "").split(",").map((s) => s.trim()).filter(Boolean)) units -= u64(await account(w), 64);
        const circ = Number(units) / 10 ** decimals;
        body = { circulatingSupply: Math.max(0, circ) };
      } catch (e) { body = { error: "supply unavailable", detail: String(e).slice(0, 160) }; status = 502; }
      const res = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": `public, max-age=${status === 200 ? 300 : 30}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
      if (status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    // /usd: dollars per coin. /coins: the same with each coin's 24h move.
    if (url.pathname === "/usd" || url.pathname === "/coins") {
      const cache = caches.default, key = new Request(url.origin + url.pathname);
      const hit = await cache.match(key); if (hit) return hit;
      let body, age = 60;
      try { const q = await coinQuotes(env); body = url.pathname === "/usd" ? Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.usd])) : q; } catch (e) { body = {}; age = 10; }
      const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${age}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    if (url.pathname !== "/prices" && url.pathname !== "/chart") return env.ASSETS.fetch(request);
    const cache = caches.default;
    const key = new Request(url.origin + url.pathname + (url.pathname === "/chart" ? `?coin=${url.searchParams.get("coin")}&sym=${url.searchParams.get("sym")}` : ""));
    let maxAge;
    const debug = url.searchParams.has("debug");
    const hit = debug ? null : await cache.match(key);
    if (hit) return hit;

    let body;
    if (url.pathname === "/chart") {
      // by coin (its anchor), or by a plain symbol Yahoo carries — used for
      // the devnet stand-in feeds and for custom rounds
      const SYMS = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD", XRP: "XRP-USD", BNB: "BNB-USD", ZEC: "ZEC-USD", SPY: "SPY", GLDx: "GLD", GLD: "GLD", SPYx: "SPY" };
      const sym = url.searchParams.get("sym");
      const coinKey = url.searchParams.get("coin");
      const coin = sym ? (Object.hasOwn(SYMS, sym) ? { kind: "yahoo", symbol: SYMS[sym] } : sym === "STONK" ? { ...COINS.KNOTS, kv: env.SERIES, key: "KNOTS" } : null) : coinKey && Object.hasOwn(COINS, coinKey) ? { ...COINS[coinKey], kv: env.SERIES, key: coinKey } : null;
      if (!coin) return new Response("unknown coin", { status: 404 });
      const tapeCoin = coinKey || Object.keys(COINS).find((k) => COINS[k].symbol === SYMS[sym]) || (sym === "STONK" ? "KNOTS" : null);
      const t = tapeCoin ? await fromTape(env, `/candles?coin=${tapeCoin}&res=300`) : null;
      if (t?.candles?.length > 12) { body = { points: t.candles.map((c) => [c[0], c[4]]), source: "pool" }; maxAge = 30; }
      else { try { body = { points: await series(coin) }; } catch (e) { body = { points: [], error: String(e).slice(0, 100) }; } maxAge = 300; }
    } else {
      // The tape (live, from the pools) is the first source; each coin it
      // lacks falls through to the market-data sources below.
      body = {};
      const tape = await fromTape(env, "/prices");
      if (tape) for (const [sym, q] of Object.entries(tape)) if (Object.hasOwn(COINS, sym) && typeof q?.price === "number") body[sym] = { price: q.price, at: q.at, change24h: q.change24h ?? null, source: "pool" };
      await Promise.all(Object.entries(COINS).filter(([sym]) => !body[sym]).map(async ([sym, src0]) => {
        const src = { ...src0, kv: env.SERIES, key: sym };
        const qkey = new Request(`${url.origin}/q/${sym}`);
        try {
          const pts = await series(src);
          const last = pts[pts.length - 1], first = pts[0];
          if (!last) throw new Error("empty");
          body[sym] = { price: last[1], at: last[0], change24h: pts.length > 1 ? (last[1] / first[1] - 1) * 100 : null };
          ctx.waitUntil(cache.put(qkey, new Response(JSON.stringify(body[sym]), { headers: { "cache-control": "public, max-age=3600" } })));
        } catch (e1) {
          if (debug) body[sym + "_err"] = String(e1).slice(0, 120);
          // GeckoTerminal drops requests now and then; DexScreener has the same pool's spot price.
          if (src.quoteFallback === "dexscreener") {
            try {
              const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${src.pool}`, { headers: UA });
              if (debug) body[sym + "_ds"] = r.status;
              const j = await r.json();
              const p = j.pairs?.[0] ?? j.pair;
              if (p?.priceUsd) {
                body[sym] = { price: Number(p.priceUsd), at: Math.floor(Date.now() / 1000), change24h: p.priceChange?.h24 ?? null };
                ctx.waitUntil(cache.put(qkey, new Response(JSON.stringify(body[sym]), { headers: { "cache-control": "public, max-age=3600" } })));
                return;
              }
            } catch (e2) { if (debug) body[sym + "_err2"] = String(e2).slice(0, 120); }
          }
          const old = await cache.match(qkey);
          if (old) body[sym] = { ...(await old.json()), stale: true };
        }
      }));
      maxAge = tape ? 5 : 60;
    }
    const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};

// stooks.xyz: static assets, plus two small data routes the page and the app
// read. Market data for display comes from public sources (Yahoo, CoinGecko,
// GeckoTerminal); settlement on chain is Pyth and only Pyth. Cached at the
// edge so the sources see one request a minute, not one per visitor.
const COINS = {
  STOOK: { kind: "yahoo", symbol: "SPY" },
  ZCAT: { kind: "yahoo", symbol: "ZEC-USD" },   // CoinGecko rate-limits Cloudflare egress; Yahoo carries ZEC 24/7
  KNOTS: { kind: "geckoterminal", pool: "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49", quoteFallback: "dexscreener" }, // STONK/SOL on Raydium
  GP: { kind: "yahoo", symbol: "GLD" },
};
const UA = { "user-agent": "Mozilla/5.0 stook-street" };

/** [ [unix seconds, price], … ] over roughly the last day, oldest first. */
async function series(src) {
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
    const j = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${src.pool}/ohlcv/minute?aggregate=15&limit=96`, { headers: UA })).json();
    return j.data.attributes.ohlcv_list.map(([t, , , , close]) => [t, close]).reverse();
  }
  return [];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/prices" && url.pathname !== "/chart") return env.ASSETS.fetch(request);
    const cache = caches.default;
    const key = new Request(url.origin + url.pathname + (url.pathname === "/chart" ? `?coin=${url.searchParams.get("coin")}&sym=${url.searchParams.get("sym")}` : ""));
    const debug = url.searchParams.has("debug");
    const hit = debug ? null : await cache.match(key);
    if (hit) return hit;

    let body, maxAge;
    if (url.pathname === "/chart") {
      // by coin (its anchor), or by a plain symbol Yahoo carries — used for
      // the devnet stand-in feeds and for custom rounds
      const SYMS = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", DOGE: "DOGE-USD", XRP: "XRP-USD", BNB: "BNB-USD", ZEC: "ZEC-USD", SPY: "SPY", GLDx: "GLD", GLD: "GLD", SPYx: "SPY" };
      const sym = url.searchParams.get("sym");
      const coin = sym ? (SYMS[sym] ? { kind: "yahoo", symbol: SYMS[sym] } : sym === "STONK" ? COINS.KNOTS : null) : COINS[url.searchParams.get("coin")];
      if (!coin) return new Response("unknown coin", { status: 404 });
      try { body = { points: await series(coin) }; } catch (e) { body = { points: [], error: String(e).slice(0, 100) }; }
      maxAge = 300;
    } else {
      // Each source hiccups on its own schedule; a coin whose source fails
      // keeps its last good quote (kept for an hour) instead of going dark.
      body = {};
      await Promise.all(Object.entries(COINS).map(async ([sym, src]) => {
        const qkey = new Request(`${url.origin}/q/${sym}`);
        try {
          const pts = await series(src);
          const last = pts[pts.length - 1], first = pts[0];
          if (!last) throw new Error("empty");
          body[sym] = { price: last[1], at: last[0], change24h: first ? (last[1] / first[1] - 1) * 100 : null };
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
      maxAge = 60;
    }
    const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*" } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};

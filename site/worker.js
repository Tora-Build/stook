// stooks.xyz: static assets, plus two small data routes the page and the app
// read. Market data for display comes from public sources (Yahoo, CoinGecko,
// GeckoTerminal); settlement on chain is Pyth and only Pyth. Cached at the
// edge so the sources see one request a minute, not one per visitor.
const COINS = {
  STOOK: { kind: "yahoo", symbol: "SPY" },
  ZCAT: { kind: "yahoo", symbol: "ZEC-USD" },   // CoinGecko rate-limits Cloudflare egress; Yahoo carries ZEC 24/7
  KNOTS: { kind: "geckoterminal", pool: "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49" }, // STONK/SOL on Raydium
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
    const key = new Request(url.origin + url.pathname + (url.pathname === "/chart" ? `?coin=${url.searchParams.get("coin")}` : ""));
    const hit = await cache.match(key);
    if (hit) return hit;

    let body, maxAge;
    if (url.pathname === "/chart") {
      const coin = COINS[url.searchParams.get("coin")];
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
        } catch {
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

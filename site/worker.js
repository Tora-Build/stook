import { aiChatter, bellIn, grammarChatter } from "./chatter.js";
import { nyNow, runX, whoAmI } from "./xpost.js";
import FEEDS from "../apps/stook/src/lib/feeds.json";

// The feeds the app can show; /pyth answers for these only, so the key it
// holds cannot be spent on anything else.
const FEED_IDS = new Set(FEEDS.map((f) => f.id.toLowerCase()));

// stookstreet.xyz: static assets, plus two small data routes the page and the app
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

// KV is read through a minute of memory: an isolate serves many requests, and
// the free plan counts every read. (A cached-at-the-edge read still counts.)
const memo = new Map();
async function kvJson(kv, key, ttl = 60_000) {
  const m = memo.get(key); if (m && Date.now() - m.at < ttl) return m.v;
  const v = await kv.get(key, "json"); memo.set(key, { at: Date.now(), v }); return v;
}

/** [ [unix seconds, price], … ] over roughly the last day, oldest first.
 *  Requests only read the stored day; `record` (the five-minute cron, one
 *  writer for the whole world) appends to it. */
async function series(src, record = false) {
  if (src.kind === "raydium-clmm") {
    const [perQuote, quote] = await Promise.all([clmmPrice(src.pool, src.quoteDecimals, src.baseDecimals), series({ kind: "yahoo", symbol: src.quoteSymbol })]);
    const q = quote[quote.length - 1];
    if (!q) return [];
    const point = [Math.floor(Date.now() / 1000), q[1] / perQuote];
    // Keep our own day of history: one point per five minutes in KV.
    if (!src.kv) return [point];
    const key = `series:${src.key}`, dayAgo = point[0] - 86_400;
    let pts = ((record ? await src.kv.get(key, "json") : await kvJson(src.kv, key)) || []).filter((p) => p[0] >= dayAgo);
    if (record) { pts.push(point); await src.kv.put(key, JSON.stringify(pts)); memo.delete(key); return pts; }
    return [...pts, point];
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

// What the floor talks about: each coin's anchor (name, price, move) and the
// coin's own dollar price and move, and the time to the bell.
const ANCHORS = { STOOK: ["the S&P 500", 2], ZCAT: ["Zcash", 2], KNOTS: ["STONK", 4], GP: ["gold", 2] };
async function floorData(env) {
  const [tape, coins] = await Promise.all([fromTape(env, "/prices").catch(() => null), coinQuotes(env).catch(() => ({}))]);
  const bell = bellIn();
  const out = await Promise.all(Object.keys(COINS).map(async (k) => {
    let p = null, chg = null;
    const t = tape?.[k];
    if (typeof t?.price === "number") { p = t.price; chg = typeof t.change24h === "number" ? t.change24h : null; }
    else {
      try { const pts = await series({ ...COINS[k], kv: env.SERIES, key: k }); const l = pts[pts.length - 1], f = pts[0]; if (l) { p = l[1]; chg = pts.length > 1 ? (l[1] / f[1] - 1) * 100 : null; } } catch {}
    }
    const [anchor, dp] = ANCHORS[k] ?? [k, 2];
    return { coin: k, anchor, dp, price: p, chg, usd: coins[k]?.usd ?? null, usdChg: coins[k]?.change24h ?? null, bell };
  }));
  return { coins: out };
}

/** The AI's latest conversations, written hourly by the cron, and the lines it has used lately. */
const AI_KEY = "chatter:ai", SEEN_KEY = "chatter:seen";
async function refreshAiChatter(env, why = {}) {
  const data = await floorData(env);
  const seen = new Set((await env.SERIES.get(SEEN_KEY, "json")) ?? []);
  const fresh = await aiChatter(env, data, seen, why);
  if (!fresh.length) return 0;
  await env.SERIES.put(AI_KEY, JSON.stringify({ at: Date.now(), convos: fresh }));
  await env.SERIES.put(SEEN_KEY, JSON.stringify([...seen].slice(-400)));
  return fresh.length;
}

/** The tape's current public address (a quick tunnel, re-announced when it restarts). */
async function tapeUrl(env) { const m = memo.get("tape:url"); if (m && Date.now() - m.at < 60_000) return m.v; const v = await env.SERIES.get("tape:url"); memo.set("tape:url", { at: Date.now(), v }); return v; }

/** Ask the tape; null if it is down or slow. */
async function fromTape(env, path) {
  const base = await tapeUrl(env); if (!base) return null;
  try { const r = await fetch(base + path, { signal: AbortSignal.timeout(2500) }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

const HOME = "stookstreet.xyz";

export default {
  // Every five minutes: one point of history for the pools only we record.
  // Hourly: a fresh batch of AI chatter about what happened.
  async scheduled(event, env, ctx) {
    // The X posts run on two UTC hours each, so one of them is always the
    // right New York hour whether or not it is daylight saving time.
    // One post a day: the morning question on Tuesday and Thursday, the
    // closing bell on Monday, Wednesday and Friday. About 22 a month.
    if (event.cron === "35 13,14 * * 1-5") { const ny = nyNow(); if (ny.hour === 9 && (ny.weekday === "Tue" || ny.weekday === "Thu")) ctx.waitUntil(floorData(env).then((d) => runX(env, "morning", d)).catch((e) => console.log("x morning", String(e)))); return; }
    if (event.cron === "10 20,21 * * 1-5") { const ny = nyNow(); if (ny.hour === 16 && ["Mon", "Wed", "Fri"].includes(ny.weekday)) ctx.waitUntil(floorData(env).then((d) => runX(env, "bell", d)).catch((e) => console.log("x bell", String(e)))); return; }
    // A check asked for through KV (x:check = "whoami"): runs once, result in x:check:result.
    if (event.cron === "*/5 * * * *" && (await env.SERIES.get("x:check")) === "whoami") { await env.SERIES.delete("x:check"); await env.SERIES.put("x:check:result", JSON.stringify(await whoAmI(env).catch((e) => ({ error: String(e) }))), { expirationTtl: 86_400 }); }
    if (event.cron === "*/5 * * * *") { ctx.waitUntil(Promise.all(Object.entries(COINS).filter(([, c]) => c.kind === "raydium-clmm").map(([k, c]) => series({ ...c, kv: env.SERIES, key: k }, true).catch(() => null)))); return; }
    ctx.waitUntil(refreshAiChatter(env));
  },

  async fetch(request, env, ctx) {
    // One home: stookstreet.xyz. Pages on the old name (and on www.) move
    // there for good, path and query kept; the data routes answer on every
    // name, since the keeper, the tape and aggregators call them by address
    // and a redirected POST would lose its body.
    {
      const u = new URL(request.url);
      const data = /^\/(prices|chart|usd|coins|supply|chatter|pyth|x)$|^\/(chatter|tape|hermes)\//.test(u.pathname);
      if (u.hostname !== HOME && !data && !u.hostname.endsWith(".workers.dev") && u.hostname !== "localhost") {
        return Response.redirect(`https://${HOME}${u.pathname}${u.search}`, 301);
      }
    }
    {
      const u = new URL(request.url);
      if (u.pathname === "/x") {
        // Anyone may preview the text; only the tape token may post by hand.
        const post = u.searchParams.has("post");
        if (post && (!env.TAPE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.TAPE_TOKEN}`)) return new Response("no", { status: 401 });
        const kind = u.searchParams.get("kind") === "morning" ? "morning" : "bell";
        try { return Response.json(await runX(env, kind, await floorData(env), { dry: !post, force: post }), { headers: { "cache-control": "no-store" } }); }
        catch (e) { return Response.json({ error: String(e).slice(0, 300) }, { status: 500 }); }
      }
    }
    const url = new URL(request.url);
    // /pyth?id=: the latest Pyth price for one of the app's feeds, from
    // Hermes with the PYTH_API_KEY secret. The round page's live line uses
    // it when Pyth's on-chain price account is stale (devnet's often are).
    // Hermes for a keeper running away from the VPS: the price updates at one
    // second, for our feeds only, behind a token of its own. The Pyth key
    // stays here.
    if (url.pathname.startsWith("/hermes/v2/updates/price/")) {
      if (!env.HERMES_PROXY_TOKEN || request.headers.get("authorization") !== `Bearer ${env.HERMES_PROXY_TOKEN}`) return new Response("no", { status: 401 });
      const at = url.pathname.slice("/hermes/v2/updates/price/".length), ids = url.searchParams.getAll("ids[]").map((x) => x.toLowerCase().replace(/^0x/, ""));
      if (!/^\d{9,11}$/.test(at) || !ids.length || !ids.every((x) => FEED_IDS.has(x))) return new Response("bad request", { status: 400 });
      const q = ids.map((x) => `ids%5B%5D=${x}`).join("&") + "&encoding=base64";
      const r = await fetch(`https://hermes.pyth.network/v2/updates/price/${at}?${q}`, { headers: { authorization: `Bearer ${env.PYTH_API_KEY}` } });
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/pyth") {
      const id = (url.searchParams.get("id") ?? "").toLowerCase().replace(/^0x/, "");
      if (!FEED_IDS.has(id)) return new Response(JSON.stringify({ error: "unknown feed" }), { status: 404, headers: { "content-type": "application/json" } });
      if (!env.PYTH_API_KEY) return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers: { "content-type": "application/json" } });
      const cache = caches.default, key = new Request(`${url.origin}/pyth?id=${id}`);
      const hit = await cache.match(key); if (hit) return hit;
      let body, status = 200;
      try {
        const r = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=${id}&parsed=true&encoding=hex`, { headers: { authorization: `Bearer ${env.PYTH_API_KEY}` } });
        const p = (await r.json())?.parsed?.[0]?.price;
        if (!p) throw new Error(`hermes ${r.status}`);
        body = { price: p.price, conf: p.conf, expo: p.expo, publishTime: p.publish_time };
      } catch (e) { body = { error: "unavailable" }; status = 502; }
      const res = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": `public, max-age=${status === 200 ? 5 : 10}`, "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
      if (status === 200) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    // /chatter: conversations for the floor, from the grammar (new every
    // minute) and the AI's latest hourly batch, shuffled together.
    // The cron's job on demand, for the operator (the tape's token).
    if (url.pathname === "/chatter/refresh" && request.method === "POST") {
      if (!env.TAPE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.TAPE_TOKEN}`) return new Response("no", { status: 401 });
      const why = url.searchParams.get("model") ? { only: url.searchParams.get("model") } : {};
      return new Response(JSON.stringify({ added: await refreshAiChatter(env, why), why }), { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/chatter") {
      const cache = caches.default, key = new Request(url.origin + "/chatter");
      const hit = await cache.match(key); if (hit) return hit;
      const data = await floorData(env);
      const ai = (await kvJson(env.SERIES, AI_KEY))?.convos ?? [];
      const minute = Math.floor(Date.now() / 60_000);
      const grammar = grammarChatter(data, 36, minute * 2654435761);
      const mixed = [...ai, ...grammar].map((c, i) => [((i * 2654435761 + minute) >>> 0) % 997, c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const res = new Response(JSON.stringify({ at: Date.now(), convos: mixed }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" } });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    // The tape announces where it is.
    if (url.pathname === "/tape/register" && request.method === "POST") {
      if (!env.TAPE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.TAPE_TOKEN}`) return new Response("no", { status: 401 });
      const { url: u } = await request.json(); if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(u)) return new Response("bad url", { status: 400 });
      await env.SERIES.put("tape:url", u); memo.delete("tape:url"); return new Response("ok");
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

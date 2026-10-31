// POST /apply: an application to list a coin (the list page's form, used on
// mainnet where self-serve listing is off). Kept in the SERIES KV namespace
// under "apply:<time>:<random>" for 180 days; read them with
// `wrangler kv key list --prefix apply:`. Five per hour per address.

const TTL = 180 * 86_400;
const PER_HOUR = 5;
const MAX_BODY = 4096;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;
const HANDLE = /^@?[A-Za-z0-9_]{3,32}$|^https:\/\/(t\.me|x\.com|twitter\.com)\/[A-Za-z0-9_]{3,32}\/?$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
/** Plain text, one line (or a few for the note), no control characters, at most `n` long. */
const text = (v, n, lines = false) => (typeof v === "string" ? v : "").replace(lines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ").trim().slice(0, n);

export async function apply(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!env.SERIES) return json({ ok: false, error: "unavailable" }, 503);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ ok: false, error: "send JSON" }, 415);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "too long" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ ok: false, error: "bad JSON" }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "bad JSON" }, 400);

  const app = {
    mint: text(b.mint, 44),
    symbol: text(b.symbol, 16),
    asset: text(b.asset, 40),
    source: text(b.source, 90),
    seed: text(b.seed, 60),
    contact: text(b.contact, 60),
    note: text(b.note, 500, true),
  };
  if (!B58.test(app.mint)) return json({ ok: false, error: "The mint is not a Solana address." }, 400);
  if (!app.asset) return json({ ok: false, error: "Name the asset its rounds follow." }, 400);
  if (app.source && !HEX64.test(app.source) && !B58.test(app.source)) return json({ ok: false, error: "The price source is not a Pyth feed id or a Solana address." }, 400);
  if (!HANDLE.test(app.contact)) return json({ ok: false, error: "Give a Telegram or X handle." }, 400);

  // A rough limit per address: a counter that lives an hour.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rk = `apply-rate:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const n = Number((await env.SERIES.get(rk)) ?? 0);
  if (n >= PER_HOUR) return json({ ok: false, error: "Too many tries. Message us on Telegram." }, 429);
  await env.SERIES.put(rk, String(n + 1), { expirationTtl: 3600 + 60 });

  const at = Date.now();
  const id = `apply:${at}:${crypto.randomUUID().slice(0, 8)}`;
  await env.SERIES.put(id, JSON.stringify({ ...app, at, country: request.cf?.country ?? null }), { expirationTtl: TTL });
  return json({ ok: true });
}

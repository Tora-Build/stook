// Posts to X as @StookStreet, from the worker's own cron: one post a weekday,
// the morning question (Tue, Thu) or the closing bell (Mon, Wed, Fri). About
// 22 posts a month, under a hard monthly cap that leaves room for a few
// extra posts, so the pay-per-use bill stays small. Keys live in
// Cloudflare secrets (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN,
// X_ACCESS_SECRET), set with `wrangler secret put`; never in the repo.

const MONTHLY_CAP = 46;

/** New York's calendar and clock for a moment. */
export function nyNow(now = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, ym: `${p.year}-${p.month}`, hour: +p.hour, weekday: p.weekday, label: new Date(now).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }) };
}

const name = (a) => { const n = a.replace(/^the /, ""); return n[0].toUpperCase() + n.slice(1); };
const num = (v, dp) => (typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "…");
const move = (c) => (typeof c === "number" ? `${c >= 0 ? "▲" : "▼"}${Math.abs(c).toFixed(2)}%` : "");

export function bellText(data, ny) {
  const rows = data.coins.map((c) => `${name(c.anchor)} ${num(c.price, c.dp)} ${move(c.chg)}`.trim()).join("\n");
  return `🔔 Closing bell · ${ny.label}\n\n${rows}\n\nThe next tables are open 👉 stooks.xyz\nDevnet · test coins`;
}

export function morningText(data, ny) {
  // A different table each weekday.
  const order = { Tue: 0, Thu: 3, Mon: 1, Wed: 2, Fri: 0 }, c = data.coins[order[ny.weekday] ?? 0] ?? data.coins[0];
  return `Where does ${c.anchor} close today? 🔔\n\n${num(c.price, c.dp)} now. Bell at 4 PM New York.\nCall it with ${c.coin}. The closer you call, the more you're paid.\n\n👉 stooks.xyz (devnet, free test coins)`;
}

// OAuth 1.0a, user context: the only way the API lets an app post as a user.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function oauthHeader(method, url, env) {
  const o = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: crypto.randomUUID().replace(/-/g, ""), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: "1.0" };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)))));
  return "OAuth " + Object.entries({ ...o, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function tweet(env, text) {
  const url = "https://api.x.com/2/tweets";
  const r = await fetch(url, { method: "POST", headers: { authorization: await oauthHeader("POST", url, env), "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`x ${r.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

/** Who the keys belong to: a read, no post. For checking the keys work. */
export async function whoAmI(env) {
  const url = "https://api.x.com/2/users/me";
  const r = await fetch(url, { headers: { authorization: await oauthHeader("GET", url, env) } });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 300) };
}

/** Post `kind` once per New York day, inside the monthly cap. `dry` only returns the text. */
export async function runX(env, kind, data, { dry = false, force = false, now = Date.now() } = {}) {
  const ny = nyNow(now);
  const text = kind === "bell" ? bellText(data, ny) : morningText(data, ny);
  if (dry) return { dry: true, text };
  if (!env.X_API_KEY || !env.X_API_SECRET || !env.X_ACCESS_TOKEN || !env.X_ACCESS_SECRET) return { skipped: "no keys", text };
  const doneKey = `x:done:${ny.ymd}:${kind}`, countKey = `x:count:${ny.ym}`;
  if (!force && (await env.SERIES.get(doneKey))) return { skipped: "already posted today", text };
  const count = +((await env.SERIES.get(countKey)) ?? 0);
  if (count >= MONTHLY_CAP) return { skipped: `monthly cap of ${MONTHLY_CAP} reached`, text };
  const res = await tweet(env, text);
  await env.SERIES.put(doneKey, "1", { expirationTtl: 3 * 86_400 });
  await env.SERIES.put(countKey, String(count + 1), { expirationTtl: 40 * 86_400 });
  return { posted: res?.data?.id ?? true, text, month: count + 1 };
}

// Posts to X as @StookStreet: one poster video a weekday, the morning
// question (Tue, Thu) or the closing bell (Mon, Wed, Fri). The box renders
// the video (infra/x-poster) and hands it to /x/video; this file uploads and
// posts it. Keys live in Cloudflare secrets (X_API_KEY, X_API_SECRET,
// X_ACCESS_TOKEN, X_ACCESS_SECRET), set with `wrangler secret put`; never in
// the repo.
//
// The bill: X charges $0.015 a post but $0.20 for a post with a link, so a
// post never carries one (the video shows the address, the bio links it).
// With the upload's few calls at $0.005 each, a post costs about 4-5 cents;
// the cap of 23 a month (one per weekday) keeps a month near $1.

const MONTHLY_CAP = 23;
// Anything X would turn into a link.
const LINKISH = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(xyz|com|io|app|fun|net|org|co|gg|so)\b/i;

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
  return `🔔 Closing bell · ${ny.label}\n\n${rows}\n\nThe next tables are open 👉 stookstreet.xyz\nDevnet · test coins`;
}

export function morningText(data, ny) {
  // A different table each weekday.
  const order = { Tue: 0, Thu: 3, Mon: 1, Wed: 2, Fri: 0 }, c = data.coins[order[ny.weekday] ?? 0] ?? data.coins[0];
  return `Where does ${c.anchor} close today? 🔔\n\n${num(c.price, c.dp)} now. Bell at 4 PM New York.\nCall it with ${c.coin}. The closer you call, the more you're paid.\n\n👉 stookstreet.xyz (devnet, free test coins)`;
}

// OAuth 1.0a, user context: the only way the API lets an app post as a user.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function oauthHeader(method, url, env, query = {}) {
  const o = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: crypto.randomUUID().replace(/-/g, ""), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: "1.0" };
  const all = { ...o, ...query }, params = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join("&");
  const base = [method, enc(url), enc(params)].join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)))));
  return "OAuth " + Object.entries({ ...o, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function tweet(env, text, mediaId) {
  const url = "https://api.x.com/2/tweets";
  const r = await fetch(url, { method: "POST", headers: { authorization: await oauthHeader("POST", url, env), "content-type": "application/json" }, body: JSON.stringify(mediaId ? { text, media: { media_ids: [mediaId] } } : { text }) });
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

// X's v2 chunked upload: initialize, append in 4 MB pieces, finalize, then
// wait for the video to be processed.
async function xcall(env, method, url, { json, form, query } = {}) {
  const full = query ? `${url}?${new URLSearchParams(query)}` : url;
  const headers = { authorization: await oauthHeader(method, url, env, query) };
  if (json) headers["content-type"] = "application/json";
  const r = await fetch(full, { method, headers, body: json ? JSON.stringify(json) : form });
  const body = await r.text();
  if (!r.ok) throw new Error(`x ${method} ${url.split("/2/")[1]} ${r.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}
async function uploadVideo(env, bytes) {
  const base = "https://api.x.com/2/media/upload";
  const init = await xcall(env, "POST", `${base}/initialize`, { json: { media_type: "video/mp4", total_bytes: bytes.byteLength, media_category: "tweet_video" } });
  const id = init.data.id, CHUNK = 4 * 1024 * 1024;
  for (let i = 0, k = 0; i < bytes.byteLength; i += CHUNK, k++) {
    const form = new FormData(); form.append("segment_index", String(k)); form.append("media", new Blob([bytes.slice(i, i + CHUNK)], { type: "video/mp4" }), "poster.mp4");
    await xcall(env, "POST", `${base}/${id}/append`, { form });
  }
  let info = (await xcall(env, "POST", `${base}/${id}/finalize`)).data?.processing_info;
  for (let tries = 0; info && info.state !== "succeeded"; tries++) {
    if (info.state === "failed" || tries > 20) throw new Error(`x video processing ${info.state}: ${JSON.stringify(info.error ?? {})}`);
    await new Promise((r) => setTimeout(r, Math.min(10, info.check_after_secs ?? 3) * 1000));
    info = (await xcall(env, "GET", base, { query: { command: "STATUS", media_id: id } })).data?.processing_info;
  }
  return id;
}

/** Post the box's video for `kind`, once per New York day and inside the
 * monthly cap. `check` only answers whether a post would go out, so the box
 * renders nothing on a day that is already done. */
export async function runXVideo(env, kind, text, bytes, { check = false, now = Date.now() } = {}) {
  const ny = nyNow(now);
  if (!env.X_API_KEY || !env.X_API_SECRET || !env.X_ACCESS_TOKEN || !env.X_ACCESS_SECRET) return { skipped: "no keys" };
  const doneKey = `x:done:${ny.ymd}`, countKey = `x:count:${ny.ym}`;
  if (await env.SERIES.get(doneKey)) return { skipped: "already posted today" };
  const count = +((await env.SERIES.get(countKey)) ?? 0);
  if (count >= MONTHLY_CAP) return { skipped: `monthly cap of ${MONTHLY_CAP} reached` };
  if (check) return { ok: true, month: count };
  // A link would cost 13 times a plain post: drop any line that has one.
  text = (text ?? "").split("\n").filter((l) => !LINKISH.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 280);
  if (!text || !bytes?.byteLength) return { skipped: "nothing to post" };
  // Mark the day before posting: a failure after this costs a missed day, never a double post.
  await env.SERIES.put(doneKey, kind, { expirationTtl: 3 * 86_400 });
  await env.SERIES.put(countKey, String(count + 1), { expirationTtl: 40 * 86_400 });
  const media = await uploadVideo(env, bytes);
  const res = await tweet(env, text, media);
  return { posted: res?.data?.id ?? true, text, month: count + 1 };
}

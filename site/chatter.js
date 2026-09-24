// The floor's chatter. Two sources, mixed:
//
//   the grammar  every request builds fresh conversations from a large set of
//                templates, filled with the live numbers (each anchor's price
//                and move, each coin's dollar price and move, the time to the
//                bell). Millions of combinations, so it does not repeat, and
//                every number in it is real. Free, instant, never down.
//   the AI       once an hour a small model on Cloudflare Workers AI writes a
//                few conversations about what actually happened. Every number
//                it uses must be one of ours, and a line seen in the last few
//                hundred is dropped. If the free allowance runs out or it
//                errors, the grammar carries on alone.
//
// A conversation is { coin, lines: [text, …] } (two to four lines, speakers
// alternate). The tone is a trading floor's: salty, never slurs, never "buy
// this coin".

// ── small helpers ─────────────────────────────────────────────────────────────
const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** Dollars, the Jupiter way under a tenth of a cent: $0.0₅324. */
export function usd(v) {
  if (v == null || !(v > 0)) return "…";
  if (v >= 1) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 0.001) return "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 3 });
  const z = Math.floor(-Math.log10(v));
  return "$0.0" + String(z).split("").map((d) => SUB[+d]).join("") + (Math.round(v * 10 ** (z + 3)).toString().replace(/0+$/, "") || "0");
}
const price = (v, dp) => (v == null ? "…" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const pct = (v) => (v == null ? "flat" : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%");
const abs = (v) => (v == null ? "0" : Math.abs(v).toFixed(1));

/** A small seeded random source, so one batch is consistent and the next is new. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ── the grammar ───────────────────────────────────────────────────────────────
// Slots: {coin} {anchor} {price} {chg} {abs} {up} {usd} {cchg} {bell} {level}
// {near} {far}. Moods pick from the anchor's move and the coin's.

const LEAD = ["", "", "", "Look, ", "Honestly, ", "Word on the floor: ", "Mark my words, ", "Between us, ", "Listen. ", "Heads up: ", "Not gonna lie, ", "Real talk: ", "Swear to god, ", "Hear me out: ", "Quick one: "];

const FACT = [
  "{anchor}'s at {price}.", "{anchor} is {chg} on the day.", "{anchor} moved {abs}% since yesterday.", "{anchor} sitting at {price}, {chg}.",
  "{coin} trades at {usd}.", "{coin} is {cchg} today.", "{coin} at {usd}, {cchg} on the day.", "bell's in {bell}.",
  "{bell} to the bell.", "the tape says {price} on {anchor}.", "{anchor} printed {price} a minute ago.", "{coin} holders are {cchg} today.",
  "the crowd has {anchor} closing near {near}.", "the odds lean {near} on {anchor}.", "somebody's line on {anchor} sits at {far}.", "the widest line on {coin} tops out near {far}.",
];

const TAKE = {
  hot: [
    "{anchor}'s running and the bands can't keep up.", "every short on {coin} is sweating.", "that's a {far} print if it holds.", "whoever called {level} is smiling.",
    "ring the bell early, I'm done.", "this is why you don't fade {anchor}.", "the house on {coin} is paying out today.", "reach 8 still isn't wide enough.",
  ],
  cold: [
    "{anchor} is getting hit hard.", "every long on {coin} is toast.", "the house on {coin} is eating well.", "don't catch that knife.",
    "I said range, you said line.", "the pool's collecting on every wrong line.", "{near}'s the new ceiling.", "somebody's line at {far} is a donation.",
  ],
  flat: [
    "nothing's moving, middle band all day.", "the house is just collecting fees.", "I could draw a line blindfolded.", "dead tape, tight bands, easy money for the house.",
    "boring is profitable if you're the house.", "the crowd's asleep on {coin}.", "one band either side and you're right.", "somebody wake {anchor} up.",
  ],
  any: [
    "my line's at {level}.", "I'm the house on {coin} today.", "I've got a range from {near} to {far}.", "reach 3, centre {level}, done.",
    "the odds are wrong and I'm getting paid.", "I'm drawing at {near} and going to lunch.", "the crowd's too tight on {coin}.", "fund the {coin} round or stop talking.",
    "I sold my {coin} line, buying it back lower.", "whoever seeds tomorrow's {coin} round eats the fees.", "the pool on {coin} could use a whale.", "I'll take the other side of that.",
  ],
};

const REPLY = [
  "Bullshit.", "No chance.", "You said that last week.", "Fine, {level}. Now shut up.", "Then fund the pool.", "Bet.", "I'll take that bet.", "Sure. And I'm the Fed.",
  "Draw the line, stop talking.", "{chg}? That's noise.", "The crowd's got it at {near}, genius.", "Bell's in {bell}, move.", "Wider band, smaller mouth.", "Ha. {price}. Pay up.",
  "Not with my {coin}.", "Range it and sleep.", "Your line's four bands out. Good luck.", "The odds already say {near}.", "Fees pay either way.", "{coin} at {usd}? Cheap chips.",
  "Show me the odds.", "That's a {far} print by Friday.", "The house always eats.", "Give it an hour.", "You'd draw a line on a heart monitor.", "If you're so sure, be the house.",
  "Told you. {price}.", "Nobody cares about your line.", "Reach 2. Pick a band.", "{coin} {cchg}? The chips moved more than the stock.",
];

const CLOSE = ["Deal.", "We'll see.", "Ha.", "Fine.", "Back to it.", "Watch the tape.", "Later.", "Mm.", "Nope.", "Coffee.", "Size down.", "Your funeral.", "Tape doesn't lie.", "Shut up and trade.", "Bell's at four.", "Wake me at the close.", "Don't be a hero.", "See you at the bell."];

const moodOf = (c) => (c.chg == null ? "flat" : c.chg > 2 ? "hot" : c.chg < -2 ? "cold" : "flat");

function fill(tpl, c, r) {
  const lvl = (lo, hi) => price(c.price == null ? null : c.price * (1 + lo + r() * (hi - lo)), c.dp);
  return tpl
    .replace(/\{coin\}/g, "$" + c.coin).replace(/\{anchor\}/g, c.anchor)
    .replace(/\{price\}/g, price(c.price, c.dp)).replace(/\{chg\}/g, pct(c.chg)).replace(/\{abs\}/g, abs(c.chg))
    .replace(/\{up\}/g, c.chg == null ? "flat" : c.chg >= 0 ? "up" : "down")
    .replace(/\{usd\}/g, usd(c.usd)).replace(/\{cchg\}/g, pct(c.usdChg)).replace(/\{bell\}/g, c.bell)
    .replace(/\{level\}/g, lvl(-0.015, 0.015)).replace(/\{near\}/g, lvl(-0.008, 0.008)).replace(/\{far\}/g, lvl(0.04, 0.09));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** `n` fresh conversations from the grammar, for the coins in `data`. */
export function grammarChatter(data, n, seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)];
  const coins = data.coins.filter((c) => c.price != null || c.usd != null);
  if (!coins.length) return [];
  const out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 6; tries++) {
    const c = pick(coins), mood = moodOf(c);
    const take = r() < 0.6 ? pick(TAKE[mood]) : pick(TAKE.any);
    const opener = cap(fill(pick(LEAD) + (r() < 0.55 ? pick(FACT) + " " + cap(take) : cap(take)), c, r));
    const lines = [opener, fill(pick(REPLY), c, r)];
    const k = r();
    if (k < 0.3) lines.push(cap(fill(r() < 0.5 ? pick(FACT) : pick(TAKE.any), c, r)), pick(CLOSE));
    else if (k < 0.7) lines.push(pick(CLOSE));
    const key = lines.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ coin: c.coin, lines });
  }
  return out;
}

// ── the AI ────────────────────────────────────────────────────────────────────
// Small, cheap models on the free allowance, tried in order (models retire;
// the first one used here was withdrawn in 2026).
// Non-reasoning models: reasoning ones spend the budget thinking and return
// nothing. Llama 3.3 70B writes the best floor talk within the allowance.
const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"];
const BANNED = /\b(nigg|fag|retard|kike|spic|chink|rape|kill yourself|kys)\w*/i;
const ADVICE = /\b(buy|ape|load up on|accumulate|moon(ing)?|100x|guaranteed|financial advice)\b/i;

/** Every number a line may quote: the data's own, as we format them, plus the bell's four and small counts. */
function allowedNumbers(data) {
  const ok = new Set(["4", "1", "2", "3", "5", "8", "10", "90"]);
  const add = (s) => { for (const m of String(s).matchAll(/\d[\d,.]*/g)) ok.add(m[0].replace(/[,.]$/, "")); };
  for (const c of data.coins) { add(price(c.price, c.dp)); add(pct(c.chg)); add(abs(c.chg)); add(usd(c.usd)); add(pct(c.usdChg)); add(c.bell); }
  return ok;
}
const numbersIn = (s) => [...s.matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[,.]$/, ""));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Ask the model for conversations, then keep only the ones that pass. */
export async function aiChatter(env, data, seen, why = {}) {
  if (!env.AI) { why.error = "no AI binding"; return []; }
  const facts = data.coins.map((c) => `$${c.coin} (a memecoin) plays ${c.anchor}: ${c.anchor} is at ${price(c.price, c.dp)}, ${pct(c.chg)} today; $${c.coin} trades at ${usd(c.usd)}, ${pct(c.usdChg)} today`).join("\n");
  const sys = `You write overheard chatter between traders on Stook Street, a pixel-art trading floor. Each coin (a memecoin) has one round a day: players draw a "line" on a price band where the coin's anchor will close at 4 PM New York (the bell) and get paid in the coin; a line pays most on its band, a "range" pays flat across bands; "the house" funds the pool and keeps 90% of fees. The traders are an old-timer, a degen, a quant, a doomer and a rookie, but never write their names or labels: just what they say. Style: salty, funny, specific, confident, like a real floor. Talk about the numbers, where it closes, lines, bands, the house, the bell, the coin's own move versus its anchor. Rules: no slurs, no hate, nothing sexual, never tell anyone to buy a coin, never promise profits. Only use numbers exactly as written in the facts. Each line under 80 characters.

Examples of the tone:
["Zcash down 9% and the $ZCAT house is eating every long.", "Should've drawn a range, genius."]
["Gold hasn't moved all day.", "Middle band, collect the fees, go home."]
["$KNOTS up 39% while STONK did 15. The chips outran the stock.", "Degens gonna degen.", "Bell's in two hours, calm down."]`;
  const user = `Facts right now (the bell is in ${data.coins[0]?.bell ?? "a while"}):\n${facts}\n\nWrite 10 short conversations between two traders about these facts. Reply with JSON only: [{"coin":"STOOK","lines":["...","..."]}, ...], 2 to 4 lines each.`;
  let text = "";
  for (const model of why.only ? [why.only] : MODELS) {
    try {
      const res = await env.AI.run(model, { messages: [{ role: "system", content: sys }, { role: "user", content: user }], max_tokens: 1800, temperature: 0.9 });
      // Models answer in one of two shapes: { response } or OpenAI's { choices }.
      const msg = res?.choices?.[0]?.message;
      text = (typeof res?.response === "string" && res.response) || msg?.content || (typeof res?.response === "object" ? JSON.stringify(res.response) : "") || "";
      why.shape = JSON.stringify(res).slice(0, 300);
      why.model = model;
      if (text) break;
    } catch (e) { why.error = String(e).slice(0, 200); }
  }
  if (!text) return [];
  why.raw = text.slice(0, 600);
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");            // reasoning models think out loud first
  // Small models write sloppy JSON: trailing commas, stray control
  // characters, a cut-off tail. Parse the whole array if it will, else
  // salvage each conversation object on its own.
  const clean = (t) => t.replace(/[\u0000-\u001f]+/g, " ").replace(/,\s*([\]}])/g, "$1");
  let convos = null;
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start >= 0 && end > start) { try { convos = JSON.parse(clean(text.slice(start, end + 1))); } catch {} }
  if (!Array.isArray(convos)) {
    convos = [];
    for (const m of text.matchAll(/\{[^{}]*\}/g)) { try { convos.push(JSON.parse(clean(m[0]))); } catch {} }
    if (!convos.length) { why.error = "no parseable conversations"; return []; }
  }
  why.rejected = [];
  const ok = allowedNumbers(data), known = new Set(data.coins.map((c) => c.coin));
  const out = [];
  for (const c of Array.isArray(convos) ? convos : []) {
    const coin = String(c?.coin ?? "").replace(/^\$/, "").toUpperCase();
    const lines = (Array.isArray(c?.lines) ? c.lines : []).map((l) => String(l).replace(/^[A-Za-z][\w -]{0,14}:\s+/, "").replace(/[—–]/g, ",").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
    if (!known.has(coin) || lines.length < 2) continue;
    const bad = lines.some((l) => l.length > 110 || BANNED.test(l) || ADVICE.test(l) || numbersIn(l).some((n) => !ok.has(n)) || seen.has(norm(l)));
    if (bad) { why.rejected.push(lines.join(" / ").slice(0, 160)); continue; }
    lines.forEach((l) => seen.add(norm(l)));
    out.push({ coin, lines, ai: true });
  }
  return out;
}

/** Minutes to the next 4 PM New York, as "3 h 12 min" / "12 min". */
export function bellIn(now = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  let mins = 16 * 60 - (Number(p.hour) % 24) * 60 - Number(p.minute);
  if (mins <= 0) mins += 24 * 60;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

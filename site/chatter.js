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
// Scripts, not loose lines: each is one exchange where every line answers
// the one before, so the floor holds real conversations. Slots vary the
// words and carry the live numbers:
//   {coin} {anchor} {price} {chg} {usd} {cchg} {bell} {level} {near} {far}
//   {fu} intensifier  {bro} address  {rekt} outcome  {lol}  {curse}
// Scripts are grouped by what the market is doing, and the floor talks about
// the mood it is in.

const WORDS = {
  fu: ["fucking", "fucking", "goddamn", "absolutely"],
  bro: ["anon", "ser", "bro", "my guy", "fren"],
  rekt: ["rekt", "cooked", "liquidated", "wrecked", "done"],
  lol: ["lmao", "lol", "kek", "lmfao"],
  curse: ["Fuck me.", "Holy shit.", "Jesus fucking christ.", "Fuck yes.", "Sheesh."],
};

const SCRIPTS = {
  hot: [
    ["{anchor} {chg} today. {curse}", "Told you. My call at {level} is printing.", "Printing? You're still two bands off, {bro}.", "Shut the fuck up and let me enjoy it."],
    ["Who shorted {anchor}? It's at {price}, {lol}.", "Some jeet at the {coin} table.", "{rekt}. Pour one out."],
    ["{anchor} ripping, {chg}. The bands can't keep up.", "So call wider, {bro}. Reach 8.", "Reach 8 is for cowards. I'm on {far}.", "{far}? You're {fu} deranged. I love it."],
    ["The {coin} house is getting drained. Someone called {anchor} right.", "Wasn't me. I faded it like a {fu} idiot.", "Fading {anchor} at {chg}. Classic.", "Shut up."],
    ["{anchor} at {price}. Is this the top?", "There's no top till the bell, {bro}.", "Then my call at {far} still has a shot.", "It has a prayer. Not a shot."],
  ],
  cold: [
    ["{anchor} is getting {fu} murdered. {chg}.", "Every bullish call on {coin} is {rekt}.", "Not the house. The house is eating {fu} good today.", "Then I'm funding tomorrow. Fuck being a trader."],
    ["Who called {far}? It's {price}.", "Me. Don't {fu} talk to me.", "{lol}, ngmi."],
    ["{anchor} {chg}. Catching this knife?", "Fuck no. Range from {near} and pray.", "Cope range. Respect."],
    ["{chg} on {anchor}. Is this the bottom?", "There's no bottom until the bell.", "Then my call at {near} is {fu} {rekt}.", "Cooked and served."],
    ["{anchor} bleeding at {price}. {curse}", "The crowd saw it coming. Look at the odds.", "The crowd's always right after the fact.", "The crowd gets paid, {bro}. You don't."],
  ],
  flat: [
    ["{anchor} hasn't moved a {fu} inch. {price}.", "Middle band gang. House collects, we sleep.", "Wake me at the bell."],
    ["Dead tape on {anchor}, {bro}.", "Perfect. Tight bands, reach 2, free money.", "Free money is how you get {rekt}.", "Not today. Nothing's moving."],
    ["{anchor}'s so flat I can see my reflection.", "Great day to be the house.", "Great day to take a nap.", "Same thing, really."],
    ["{anchor} at {price}, same as an hour ago.", "Then the call's easy. {near}.", "Everyone's on {near}. That's why it pays shit.", "Paying shit beats paying nothing."],
  ],
  pump: [ // the coin ran far ahead of its anchor
    ["{coin} {cchg} while {anchor} did {chg}. The fuck?", "Chips outran the stock. Degens gonna degen.", "Doesn't matter. The round settles on {anchor}, not on {coin}.", "Tell that to my bags."],
    ["{coin} at {usd}, {cchg} today. {curse}", "And {anchor} barely moved. The chips are the trade.", "The chips are the chips. The call is on {anchor}. Focus, {bro}.", "Focus is for people without bags."],
  ],
  dump: [ // the coin fell far behind its anchor
    ["{anchor} {chg} and {coin} still bled {cchg}.", "Jeets dumping chips, not the stock.", "Doesn't matter. The round pays on where {anchor} lands. Call at {level}.", "Paid in cheaper chips though, {lol}."],
    ["{coin} {cchg} today. Who's selling?", "Paper hands. {anchor} is fine at {price}.", "Then call {anchor} and ignore the chart.", "Easier said than done, {bro}."],
  ],
  soon: [ // the bell is close
    ["{bell} to the bell, {bro}. Calls in?", "Call's at {level}. Hands off the keyboard.", "Trading locks soon anyway. The fee's at its highest.", "Fuck the fee, I'm right."],
    ["Bell in {bell}. Who's still calling?", "Me. {near}, reach 2.", "Late and tight. Bold.", "Bold pays four to one on the band."],
  ],
  any: [
    ["Where's {anchor} closing?", "{near}. Book it.", "{near}? Everyone says {near}. That's why it pays shit.", "Fine, {far}. Happy?", "No. Fuck off."],
    ["I'm the house on {coin} today.", "So you're the one taking my money.", "Ninety percent of the fees, {bro}. Call the close or pay me.", "Fuck it, target {level}."],
    ["{coin} at {usd}. Cheap chips.", "Cheap chips, expensive mistakes.", "My call at {level} says otherwise.", "Your call says a lot of shit."],
    ["Target or range on {anchor}?", "Target. Ranges are for people with jobs.", "Target {level}, reach 3. Send it.", "Sent. See you at the bell."],
    ["Anyone funding tomorrow's {coin} round?", "Why, so you can farm me?", "Fees, {bro}. The house always eats.", "Fine. I'll seed it. Don't {fu} cry later."],
    ["The odds on {anchor} are wrong.", "The odds are the crowd, genius.", "The crowd's wrong. {near} is underpriced.", "Then put your chips where your mouth is."],
    ["What's the bell at, {bro}?", "Four PM New York. {bell} from now.", "Plenty of time to be wrong.", "Plenty of time to be right."],
    ["{anchor} at {price}. What's your call?", "{level}, reach 2.", "Reach 2? {fu} coward.", "Coward with a payout."],
    ["Who's the whale in the {coin} pool?", "Not me, I'm broke from yesterday.", "Yesterday's bell {rekt} half the floor.", "And the house bought a boat."],
    ["Give me one reason {anchor} closes at {far}.", "Vibes.", "Vibes. Great. {rekt} by four.", "Vibes pay four to one on the band, {bro}."],
    ["Sold my {coin} call early.", "Paper hands, {lol}.", "Took profit. Crazy concept, I know.", "Profit on a call is just a smaller call."],
  ],
};

const moods = (c) => {
  const out = [];
  if (c.chg != null && c.chg > 3) out.push("hot");
  else if (c.chg != null && c.chg < -3) out.push("cold");
  else out.push("flat");
  if (c.usdChg != null && c.chg != null && c.usdChg - c.chg > 10) out.push("pump");
  if (c.usdChg != null && c.chg != null && c.chg - c.usdChg > 10) out.push("dump");
  const m = /(?:(\d+) h )?(\d+) min/.exec(c.bell ?? "");
  if (m && Number(m[1] ?? 0) * 60 + Number(m[2]) <= 90) out.push("soon");
  return out;
};

function fill(tpl, c, r, pick) {
  const lvl = (lo, hi) => price(c.price == null ? null : c.price * (1 + lo + r() * (hi - lo)), c.dp);
  // one level per conversation, so "{near}" means the same price on every line
  c._near ??= lvl(-0.008, 0.008); c._level ??= lvl(-0.015, 0.015); c._far ??= lvl(0.04, 0.09);
  return tpl
    .replace(/\{coin\}/g, "$" + c.coin).replace(/\{anchor\}/g, c.anchor)
    .replace(/\{price\}/g, price(c.price, c.dp)).replace(/\{chg\}/g, pct(c.chg))
    .replace(/\{usd\}/g, usd(c.usd)).replace(/\{cchg\}/g, pct(c.usdChg)).replace(/\{bell\}/g, c.bell)
    .replace(/\{level\}/g, c._level).replace(/\{near\}/g, c._near).replace(/\{far\}/g, c._far)
    .replace(/\{(fu|bro|rekt|lol|curse)\}/g, (_, k) => pick(WORDS[k]));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** `n` fresh conversations from the scripts, for the coins in `data`. */
export function grammarChatter(data, n, seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)];
  const coins = data.coins.filter((c) => c.price != null);
  if (!coins.length) return [];
  const out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 8; tries++) {
    const c = { ...pick(coins) };
    const mood = moods(c), pool = r() < 0.6 ? SCRIPTS[pick(mood)] : SCRIPTS.any;
    const script = pick(pool);
    // sometimes the exchange stops early, at a natural point
    const len = script.length > 2 && r() < 0.3 ? script.length - 1 : script.length;
    const lines = script.slice(0, len).map((t) => cap(fill(t, c, r, pick)));
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
const BANNED = /\b(nigg|fag|retard|kike|spic|chink|rape|kill yourself|kys)\w*|\$?(STOOK|ZCAT|KNOTS|GP)\b[^.!?]{0,12}\b(is|are)\s+(trash|garbage|dead|a scam|shit|shitcoin|a rug)\b/i;
// Degen talk is fine ("moon", "ape", "send it"); telling people to buy a coin is not.
const ADVICE = /\b(buy|ape into|load up on|accumulate|grab)\s+(some |more )?\$[A-Za-z]+|\bguaranteed\b|financial advice/i;

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
  const sys = `You write overheard chatter between degen traders on Stook Street, a pixel-art trading floor. Each coin (a memecoin) has one round a day: players "call" where the coin's anchor closes at 4 PM New York (the bell) by picking a price band, and get paid in the coin; a "target" pays most on its band and less on the bands around it, a "range" pays flat; "the house" funds the pool and keeps 90% of fees.

Voice: crypto degens on a trading floor. Swear freely (fuck, shit, goddamn) and use degen slang (anon, ser, fren, rekt, cooked, ngmi, wagmi, cope, send it, jeet, paper hands, bags). Funny, cocky, specific.

Each conversation is ONE thread between two traders, 3 or 4 lines: an opening take, a reply that pushes back or roasts it, a comeback, and a punchline. Every line is a full spoken sentence that directly answers the one before. Never write stat lists like "X +5%, Y -2%"; say it like a person would. No speaker names or labels. Talk about the facts: where the anchor closes, calls, targets, bands, ranges, the house, the bell, the coin running ahead of or behind its anchor.

Hard rules: roast each other, never the coins or their communities (no "X is trash", "X is dead"); no slurs, no hate, nothing sexual; never tell anyone to buy a coin; never promise profits. Use numbers only exactly as written in the facts. Each line under 80 characters.

Examples:
["Zcash down 9% and the $ZCAT house is eating every long.", "Should've played a range, dumbass.", "Ranges are for cowards.", "Cowards get paid, you got rekt."]
["Gold hasn't moved a fucking inch all day.", "Perfect, middle band and let the house pay me fees.", "You're the house? Since when do you have money?", "Since your call on the top band, anon."]
["$KNOTS is up 39% while STONK only did 15. The fuck is happening?", "Degens bidding the chips harder than the stock, ser.", "Round still settles on STONK though, focus.", "Focus is for people without bags."]
["Who the hell called the S&P that far out?", "Me, and I'll be buying drinks at the bell.", "You'll be buying drinks with what, your cope?", "Vibes pay four to one on the band, fren."]`;
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
    if (!known.has(coin) || lines.length < 3) continue;
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

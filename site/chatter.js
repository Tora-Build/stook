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
// A conversation is { coin, lines: [text, …] } (two to five lines, speakers
// alternate); coin "NEXT" is the empty table. The tone is a trading floor's:
// salty, never slurs, never "buy this coin", never news of a listing.

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
//   {coin} {anchor} {price} {chg} {abs} {usd} {cchg} {bell}
//   {level} {near} {up} {down} {far}  guesses around the price
//   {h1} {h6} {vol} {liq} {buys} {sells} {hi7} {lo7} {hi30} {lo30} {offhi} {offlo}  the pool's numbers
//   {fu} {bro} {rekt} {lol} {curse} {wish} {kind} {asset}  words
//   {a|b|c}  one of these
// Scripts are grouped by what the market is doing, and the floor talks about
// the mood it is in.

const WORDS = {
  fu: ["fucking", "goddamn", "absolutely", "bloody", "truly"],
  bro: ["anon", "ser", "bro", "my guy", "fren", "chief", "pal", "boss", "friend", "kid"],
  rekt: ["rekt", "cooked", "toast", "wrecked", "done", "finished"],
  lol: ["lmao", "lol", "kek", "lmfao", "haha", "heh"],
  curse: ["Fuck me.", "Holy shit.", "Good grief.", "Sheesh.", "Well then.", "Christ.", "Oh boy.", "Wow."],
  wish: ["$WIF", "$BONK", "$POPCAT", "$FARTCOIN", "$PENGU", "$MEW", "$GIGA", "$PNUT", "$GOAT", "$MOODENG", "$JUP", "$PUMP"],
  kind: ["a dog coin", "a cat coin", "some frog coin", "an AI coin", "a stonk coin", "a meme from last week", "a community coin", "some old-school memecoin", "a coin with a real Telegram"],
  asset: ["gold", "silver", "oil", "Nvidia", "Tesla", "Apple", "the S&P 500", "the Nasdaq", "Bitcoin", "Ether", "SOL", "Zcash", "Coinbase", "MicroStrategy"],
};

// The tables' talk is opinion and prediction, not reports of what somebody
// won: the numbers are real, the traders are not. {a|b|c} picks one wording.
const SCRIPTS = {
  hot: [
    ["{anchor} {chg} on the day. {curse}", "{Chasing|Fading} it from here feels {insane|expensive|brave}.", "So where's your close?", "{up}. {Ask me again at the bell.|I'll stand by that till four.|Screenshot it.}"],
    ["Up {abs} percent. Does {anchor} hold this into four?", "It held {h6} over six hours, so maybe.", "Maybe's not a floor, {bro}.", "Fine. {near}."],
    ["{anchor} at {price} and everybody's a genius again.", "Week high is {hi7}, genius.", "So it's got {offhi}% of room.", "Room's not the same as a reason."],
    ["Green candle, green mood. {price}.", "Green at noon, red at four. Seen it a hundred times.", "So you'd take {down}?", "{I'd take it and sleep well.|I'd at least look at it.|With both hands.}"],
    ["The market's bidding {anchor} like the odds just changed.", "{chg} isn't a new world. It's a Tuesday.", "It's a {good|decent|loud} Tuesday, though."],
    ["Numbers say {buys} buys, {sells} sells today.", "So buyers showed up.", "Buyers show up, then four o'clock shows up.", "{lol}. Then {up} it is."],
  ],
  cold: [
    ["{anchor} getting {fu} dragged. {chg}.", "Knife or bargain?", "At {price}? {Knife.|Still a knife.|A knife with a discount.}", "So {down}?", "{down}, and I'll hate myself either way."],
    ["Down {abs} percent. Week low's {lo7}.", "That's the floor everybody's watching.", "Everybody watching it is how floors break.", "Cheerful. I'd still say {near}."],
    ["{chg}. Who's still bullish on {anchor}?", "Me, at {lo7}. Not at {price}.", "So you're bullish somewhere else.", "I'm bullish on patience, {bro}."],
    ["Red day. {sells} sells in the pool.", "And {buys} buys. It's not a stampede.", "Tell that to the chart.", "The chart doesn't settle anything. Four o'clock does."],
    ["If it bounces, where to?", "{up}, tops.", "And if it doesn't?", "{down}. Then I'm a prophet."],
    ["My gut says lower. My spreadsheet says lower. My wife says stop.", "Listen to one of them.", "{down} it is.", "That's the spreadsheet talking."],
  ],
  flat: [
    ["{anchor} hasn't moved a {fu} inch. {price}.", "{chg} on the day. Riveting.", "Flat days are when the tight floors pay.", "Flat days are when they don't, too."],
    ["Quiet. Almost too quiet.", "It's {price}, not a horror film.", "Horror films end by four as well.", "{near}. Final answer."],
    ["An hour change of {h1}. Wake me if that doubles.", "It'd still be nothing.", "Exactly why {near} looks fair.", "Everybody thinks {near} looks fair. That's the catch."],
    ["Nothing's happening on {anchor}.", "Nothing's happening at {price}, specifically.", "So the crowd bunches up right there.", "And the closer floors get pricey. Funny how that works."],
    ["Boring tape. Good for the house.", "Boring tape's when the house earns its fees.", "Ninety percent of them, too.", "I've had worse jobs."],
    ["What's the range today?", "Thirty-day range is {lo30} to {hi30}. Today's is a rounding error.", "So {near}?", "So {near}. Or a nap."],
  ],
  soon: [
    ["{bell} to the bell. {Thoughts?|Where are we?|Your number?}", "{near}, give or take a floor.", "Give or take a floor is the whole game, {bro}.", "That's why I said give or take."],
    ["Fee's climbing as the bell gets close.", "Two percent, up to five near the lock.", "So the early caller pays less.", "And knows less. Pick your poison."],
    ["Trading locks an hour before the close.", "So the real deadline's {sooner than you think|earlier than it looks|not four}.", "How long's left to the bell?", "{bell}. Do the math."],
    ["Late call or no call?", "Late's pricey. No call's free.", "Free pays nothing, though.", "{lol}. Touche."],
  ],
  locked: [
    ["Locked. Nothing left to do but watch.", "{bell} to go.", "Where's your head at?", "{near}. Too late to change it anyway."],
    ["Calls are closed. Who's nervous?", "Not nervous. Just refreshing {anchor} every ten seconds.", "It's {price}.", "I know. I refreshed."],
    ["The ten-minute average decides it now.", "So one late swap can't do much.", "That's the idea.", "Good. I hate surprises at {price}."],
    ["{bell} left and {anchor} sits at {price}.", "The lock's on. It's just the bell now.", "Anybody want coffee?", "Black. Like my chart on a bad day."],
  ],
  any: [
    ["Where's {anchor} closing?", "{near}. Book it.", "{near}? Everybody says {near}.", "Fine, {far}. Happy?", "{No.|Not even slightly.|Thrilled.}"],
    ["Give me one reason it closes at {far}.", "{Vibes.|Momentum.|My horoscope.|I need it to.}", "{That's not a reason.|Great research.|Solid desk work.}", "It's four to one on my mood."],
    ["Tight floor or wide?", "Tight pays more. Wide gets paid more often.", "So what's the right answer?", "The right answer's at four o'clock."],
    ["Volume's {vol} in the last day.", "On {liq} of liquidity.", "So nobody's pushing this around cheap.", "Not cheap, and it'd have to hold for ten minutes."],
    ["Six hours says {h6}. One hour says {h1}.", "Which one do you trust?", "Neither. I trust the bell.", "The bell doesn't take requests, {bro}."],
    ["Week range is {lo7} to {hi7}.", "And we're at {price}.", "So {near} is the boring call.", "Boring's underrated."],
    ["Thirty days: low {lo30}, high {hi30}.", "We're {offlo}% off the week's low.", "Is that a lot?", "Ask me at four."],
    ["I built a model for {anchor}.", "And?", "It says {near}, with low confidence.", "So it's you, with a spreadsheet."],
    ["New here. What's a floor?", "A price band on the tower. Pick one for the 4 PM close.", "And if I'm close?", "You get paid in $SSt. Closer, more."],
    ["First time at the table. What am I looking at?", "{anchor}, at {price}. You call where it closes.", "That's it?", "That's it. Nobody said it was easy."],
    ["My grandfather read tape for a living.", "What would he say about {price}?", "Get a real job.", "Wise man. {near}?"],
    ["In my day we called this gambling.", "In your day it closed at four too.", "Fair. Where's {anchor} landing?", "{level}, if you're asking."],
    ["If you had to name one number.", "{level}.", "And your confidence?", "Same as my marriage. Medium."],
    ["Why's {coin} even tied to {anchor}?", "Because a round needs a price nobody can argue with.", "And it pays in {coin}?", "Every coin of it."],
    ["Who's the other side of my call?", "The house. Holders put in {coin} and keep 90% of the fees.", "So I'm playing the holders.", "You're paying them, unless you're right."],
    ["House or caller today?", "{House. I like fees.|Caller. I like pain.|Both, on alternate Tuesdays.}", "And the number?", "{level}."],
    ["{coin} at {usd}.", "And {anchor} at {price}.", "Two prices, one bell.", "Only one of them settles the round, {bro}."],
    ["Hot take: {anchor} ends the week higher than {price}.", "Colder take: nobody here knows.", "That's not a take, that's a fact.", "Facts are cheaper."],
    ["Above or below {price} at four?", "{Above.|Below.|Coin flip.|Above, weakly.|Below, loudly.}", "How far?", "A floor or two. Don't hold me to it."],
    ["The pool only prints a new price when somebody swaps.", "So the open can wait on a trade.", "And so can the settle.", "Patience is free, {bro}."],
    ["{Morning.|Evening.|Hey.} Seen {anchor}?", "{price}, {chg}.", "And?", "And I've got no idea, {like everyone honest|same as yesterday|but I've got a number}. {near}."],
    ["Bull case in five words.", "Up only until it isn't.", "That's six.", "See, that's why I don't do targets."],
    ["Bear case for today?", "It already had its {chg} and people get tired.", "So {down}?", "Or {near}. I contain multitudes."],
    ["Statistically it moves under two percent a day.", "So {up} is a stretch?", "A stretch, not a miracle.", "I'll take stretches for a hundred, Alex."],
  ],
  // The empty table: wishes and guesses. Nobody here knows anything, and they say so.
  next: [
    ["Who gets the empty table?", "{wish} would be fun. {asset}, maybe.", "Has anyone actually applied?", "No clue. I just like wishing."],
    ["That empty table's bugging me.", "So fill it. List a coin.", "With what?", "{wish}, on {asset}. I'd watch that."],
    ["If {wish} sat down here, what's it play?", "{asset}.", "Why {asset}?", "{Because it closes at four and doesn't care about memes.|Because it'd be funny.|Because holders already watch it.}"],
    ["I want {kind} on that table.", "Playing what?", "{asset}. Paid in the coin, obviously.", "That's a Telegram that'd never sleep."],
    ["Pure guess: next table's {kind}.", "Pure guess: you've got no idea.", "Correct. Pure guess, I said.", "{asset} though, right?", "Could be."],
    ["What's it take to get a table?", "Apply on the List page. Pick what the coin follows.", "And the house?", "Holders seed it and keep 90% of the fees."],
    ["{wish} on {asset}, or {wish} on {asset}?", "First one.", "Why?", "No reason. That's how I pick everything."],
    ["Empty seats make me nervous.", "Empty seats are just tables that haven't met their coin.", "Very deep.", "It's the {damn|fucking|office} coffee."],
    ["A coin that follows {asset} would print conversation, at least.", "Would {wish} go for it?", "Ask them. I'm a pixel.", "Fair point."],
    ["Stocks or crypto for the next anchor?", "{asset}. Clean close, easy argument.", "Boring.", "Boring settles fine, {bro}."],
    ["Which community has the guts to run its own house?", "{wish}'s lot? Maybe.", "Maybe's generous.", "It's a wish list, not a press release."],
    ["Don't start rumours about that table.", "It's not a rumour if I say I made it up.", "So what did you make up?", "{wish}, playing {asset}."],
    ["My coin deserves that chair.", "What's your coin?", "{kind}.", "And it'd play?", "{asset}, and yes, I've thought about this too much."],
    ["Could a table play {asset} at all?", "If there's a clean price at four, sure.", "And who picks?", "Whoever lists the coin."],
    ["Bet you {wish} never sits there.", "Bet you someone we've never heard of does.", "That's the better story anyway.", "Usually is, {bro}."],
    ["Dream line-up for this floor?", "$SSt. here, {wish} there, {kind} in the corner.", "All on {asset}?", "God, no. Spread them out."],
  ],
};

const moods = (c) => {
  const out = [];
  if (c.chg != null && c.chg > 2) out.push("hot");
  else if (c.chg != null && c.chg < -2) out.push("cold");
  else out.push("flat");
  const m = /(?:(\d+) h )?(\d+) min/.exec(c.bell ?? ""), left = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : 999;
  // Calls close an hour before the bell, and the fee climbs for the six before that.
  if (left <= 60) return ["locked"];
  if (left <= 360) out.push("soon");
  return out;
};

const STAT = /\{(h1|h6|vol|liq|buys|sells|hi7|lo7|hi30|lo30|offhi|offlo)\}/g;
const money = (v) => (v == null ? "…" : v >= 1000 ? "$" + (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k" : "$" + Math.round(v));
function slots(c) {
  const s = c.stats ?? {}, p = (v) => price(v, c.dp);
  return { h1: s.h1 == null ? null : pct(s.h1), h6: s.h6 == null ? null : pct(s.h6), vol: s.vol == null ? null : money(s.vol), liq: s.liq == null ? null : money(s.liq),
    buys: s.buys ?? null, sells: s.sells ?? null, hi7: s.hi7 == null ? null : p(s.hi7), lo7: s.lo7 == null ? null : p(s.lo7), hi30: s.hi30 == null ? null : p(s.hi30), lo30: s.lo30 == null ? null : p(s.lo30),
    offhi: s.hi7 && c.price ? Math.abs((s.hi7 / c.price - 1) * 100).toFixed(1) : null, offlo: s.lo7 && c.price ? Math.abs((c.price / s.lo7 - 1) * 100).toFixed(1) : null };
}
/** Can this script run on today's numbers? A missing stat rules it out. */
const usable = (script, c) => { const v = slots(c); return [...script.join(" ").matchAll(STAT)].every((m) => v[m[1]] != null); };

function fill(tpl, c, r, pick) {
  const lvl = (lo, hi) => price(c.price == null ? null : c.price * (1 + lo + r() * (hi - lo)), c.dp);
  // one level per conversation, so "{near}" means the same price on every line
  c._near ??= lvl(-0.006, 0.006); c._level ??= lvl(-0.012, 0.012); c._up ??= lvl(0.01, 0.03); c._down ??= lvl(-0.03, -0.01); c._far ??= lvl(0.04, 0.09);
  const v = slots(c);
  return tpl
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_, o) => pick(o.split("|")))
    .replace(/\{coin\}/g, "$" + (c.ticker ?? c.coin)).replace(/\{anchor\}/g, c.anchor)
    .replace(/\{price\}/g, price(c.price, c.dp)).replace(/\{chg\}/g, pct(c.chg)).replace(/\{abs\}/g, abs(c.chg))
    .replace(/\{usd\}/g, usd(c.usd)).replace(/\{cchg\}/g, pct(c.usdChg)).replace(/\{bell\}/g, c.bell)
    .replace(/\{level\}/g, c._level).replace(/\{near\}/g, c._near).replace(/\{far\}/g, c._far).replace(/\{up\}/g, c._up).replace(/\{down\}/g, c._down)
    .replace(STAT, (_, k) => v[k])
    .replace(/\{(fu|bro|rekt|lol|curse|wish|kind|asset)\}/g, (_, k) => pick(WORDS[k]))
    .replace(/\$SSt\.\./g, "$SSt.");
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** `n` fresh conversations from the scripts: the coins in `data`, and now and then the empty table. */
export function grammarChatter(data, n, seed) {
  const r = rng(seed), pick = (xs) => xs[Math.floor(r() * xs.length)];
  const coins = data.coins.filter((c) => c.price != null);
  const out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 8; tries++) {
    const next = !coins.length || r() < 0.3;
    const c = next ? { coin: "NEXT", anchor: "", bell: "" } : { ...pick(coins) };
    const pool = next ? SCRIPTS.next : (r() < 0.55 ? SCRIPTS[pick(moods(c))] : SCRIPTS.any).filter((s) => usable(s, c));
    if (!pool.length) continue;
    const script = pick(pool);
    // sometimes the exchange stops early, at a natural point
    const len = script.length > 3 && r() < 0.3 ? script.length - 1 : script.length;
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
const BANNED = /\b(nigg|fag|retard|kike|spic|chink|rape|kill yourself|kys)\w*|\$?(STOOK|SSt|ZCAT|KNOTS|GP)\b[^.!?]{0,12}\b(is|are)\s+(trash|garbage|dead|a scam|shit|shitcoin|a rug)\b/i;
// Degen talk is fine ("moon", "ape", "send it"); telling people to buy a coin is not.
// The empty table is guesswork: nothing may read as news that a coin is coming.
const RUMOUR = /\b(is|are|will be|just|has|have)\s+(listing|listed|applied|confirmed|signed)\b|\bconfirmed\b|\bpartnership\b|\bofficial(ly)?\b/i;
const ADVICE = /\b(buy|ape into|load up on|accumulate|grab)\s+(some |more )?\$[A-Za-z]+|\bguaranteed\b|financial advice/i;

/** Every number a line may quote: the data's own, as we format them, plus the bell's four and small counts. */
function allowedNumbers(data) {
  const ok = new Set(["4", "1", "2", "3", "5", "8", "10", "90"]);
  const add = (s) => { for (const m of String(s).matchAll(/\d[\d,.]*/g)) ok.add(m[0].replace(/[,.]$/, "")); };
  for (const c of data.coins) { add(price(c.price, c.dp)); add(pct(c.chg)); add(abs(c.chg)); add(usd(c.usd)); add(pct(c.usdChg)); add(c.bell); for (const v of Object.values(slots(c))) if (v != null) add(v); }
  return ok;
}
const numbersIn = (s) => [...s.matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[,.]$/, ""));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Ask the model for conversations, then keep only the ones that pass. */
export async function aiChatter(env, data, seen, why = {}) {
  if (!env.AI) { why.error = "no AI binding"; return []; }
  const facts = data.coins.map((c) => { const t = c.ticker ?? c.coin, v = slots(c); return `$${t} plays ${c.anchor}: ${c.anchor} is at ${price(c.price, c.dp)}, ${pct(c.chg)} today, ${v.h1 ?? "?"} in an hour, ${v.h6 ?? "?"} in six hours; week range ${v.lo7 ?? "?"} to ${v.hi7 ?? "?"}; 30-day range ${v.lo30 ?? "?"} to ${v.hi30 ?? "?"}; pool volume ${v.vol ?? "?"} in a day on ${v.liq ?? "?"} liquidity, ${v.buys ?? "?"} buys and ${v.sells ?? "?"} sells; $${t} trades at ${usd(c.usd)}`; }).join("\n");
  const sys = `You write overheard chatter between made-up traders on Stook Street, a pixel-art trading floor. $SSt. has one round a day: players "call" where Polymarket's token closes at 4 PM New York (the bell) by picking a price floor on a tower, and are paid in $SSt., more the closer they are. Holders are the house and keep 90% of the fees. Calls close an hour before the bell. The price is a ten-minute pool average. There is also one empty table, for the next coin to be listed.

Each conversation is ONE thread between two traders, 3 or 4 lines, each line answering the one before. Vary the voices: a loud degen, a dry old desk hand, a nervous first-timer, a quant with a bad model, a joker. Vary openings and sentence shapes. Mild swearing is fine in some threads, not all.

Write two kinds. "coin":"STOOK": predictions and arguments about where Polymarket closes today, using the facts. "coin":"NEXT": guesses about which coin might take the empty table and what it might follow (gold, Nvidia, Bitcoin, the S&P 500, and so on), said as a wish or a joke.

Hard rules: opinions and predictions only. Nobody has won, lost, placed or sold anything: no "my call is printing", no reports of other players. Never say a coin is listing, has applied or is confirmed; on the empty table they are only guessing. Roast each other, never a coin or its community. No slurs, no hate, nothing sexual. Never tell anyone to buy a coin; never promise profits. Use numbers only exactly as written in the facts. No em dashes.

Examples:
["Week high's right there and everyone's calling it again.", "Everyone called it yesterday too.", "So what's your floor?", "Lower than yours, and I'll be insufferable about it."]
["Is the tape always this slow?", "Only when you're watching it, kid.", "So where does it close?", "Somewhere that'll annoy us both."]
["Who takes the empty table?", "I'd love a cat coin on gold.", "Has anyone applied?", "No idea. I'm a pixel with opinions."]`;
  const user = `Facts right now (the bell is in ${data.coins[0]?.bell ?? "a while"}):\n${facts}\n\nWrite 10 short conversations, 7 about these facts and 3 about the empty table. Reply with JSON only: [{"coin":"STOOK","lines":["...","..."]}, ...], 2 to 4 lines each.`;
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
  const ok = allowedNumbers(data), known = new Set([...data.coins.map((c) => c.coin), "NEXT"]);
  const out = [];
  for (const c of Array.isArray(convos) ? convos : []) {
    const coin = String(c?.coin ?? "").replace(/^\$/, "").toUpperCase();
    const lines = (Array.isArray(c?.lines) ? c.lines : []).map((l) => String(l).replace(/^[A-Za-z][\w -]{0,14}:\s+/, "").replace(/[—–]/g, ",").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
    if (!known.has(coin) || lines.length < 3) continue;
    const bad = lines.some((l) => l.length > 110 || BANNED.test(l) || ADVICE.test(l) || RUMOUR.test(l) || numbersIn(l).some((n) => !ok.has(n)) || seen.has(norm(l)));
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

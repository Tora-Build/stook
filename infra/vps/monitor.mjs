// Mainnet, on Telegram (through alert.sh). Read only: no key, nothing signed.
//   node --experimental-sqlite monitor.mjs report [--print]   the state of the street, twice a day (stook-health.timer)
//   node --experimental-sqlite monitor.mjs watch [--print]    every 5 minutes (stook-monitor.timer): new trades, and what is wrong
//   node --experimental-sqlite monitor.mjs bot                answers commands from one chat (stook-bot.service)
//   node --experimental-sqlite monitor.mjs ask /status        prints what the bot would answer
// watch keeps its place in ~/.stook-monitor.json. On its first run it notes where
// the ledger is and tells nothing, so old trades are not sent again.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const HOME = "/home/zak", ALERT = `${HOME}/stook/infra/vps/alert.sh`, STATE = `${HOME}/.stook-monitor.json`;
const HOUSE = "2hMUE33LXhCg78BaXYsKwuUZRB2WeNVQonaQEeedsrAQ", MINT = "Buc1mBBU63RmtWefNSoi3w3CjZ2iQvyPjeF6bJNxCuwq";
const KEEPER = "H1xgYrQwuFHPWz6FiM6XBgVD3EyqsoPfeFqPsu9cWoP4", DEPLOY = "DMUtpDCXfmumuR5kKC5h17u1SVS632KgHVZMK4zbgRre";
const TEAM = { FftHnc6DsnWsr7amM7N7SUwVAjjWWAZSMLggv2EgPk7K: "you", [DEPLOY]: "deploy wallet", [KEEPER]: "keeper" };
const SERVICES = { "stook-keeper-mainnet": "Keeper", "stook-ledger-mainnet": "Ledger", "stook-tape": "Price tape", "stook-bot": "Telegram bot" };
const PROXY = "https://stook-rpc-mainnet.zak-a35.workers.dev", SITE = "https://stookstreet.xyz";
const RPC = process.env.RPC_URL;

const [mode, ...flags] = process.argv.slice(2), printOnly = flags.includes("--print");
const now = () => Math.floor(Date.now() / 1000);
const coins = (raw) => Number(raw) / 1e6;
const num = (v, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp });
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const who = (w) => TEAM[w] ?? short(w);
const ageOf = (f) => (existsSync(f) ? now() - Math.floor(statSync(f).mtimeMs / 1000) : Infinity);
const mins = (s) => (s === Infinity ? "never" : s < 120 ? `${s}s ago` : s < 7200 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`);
const nyTime = (t) => new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
const active = (u) => spawnSync("systemctl", ["is-active", u], { encoding: "utf8" }).stdout.trim();

const alert = (...args) => { if (printOnly) console.log("[alert]", ...args); else spawnSync(ALERT, args, { stdio: "ignore", timeout: 30_000 }); };
const problem = (key, text) => alert(`mainnet-${key}`, `MAINNET: ${text}`);
const clear = (key, text) => { if (!printOnly) spawnSync(ALERT, ["--ok", `mainnet-${key}`, `MAINNET: ${text}`], { stdio: "ignore", timeout: 30_000 }); };

async function getJson(url, opts) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), ...opts });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
const safe = async (p) => { try { return await p; } catch { return null; } };
const rpc = async (method, params) => { const r = await getJson(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); if (r.error) throw new Error(r.error.message); return r.result; };

/** The house's numbers, from its account (decodeHouse in packages/sdk-solana): after the discriminator, five keys, then assets, inRound, pendingDeposits, claimable. */
async function house() {
  const a = await rpc("getAccountInfo", [HOUSE, { encoding: "base64" }]), d = Buffer.from(a.value.data[0], "base64"), at = 8 + 5 * 32;
  const assets = d.readBigUInt64LE(at), inRound = d.readBigUInt64LE(at + 8);
  return { capital: coins(assets + inRound), inRound: coins(inRound), queued: coins(d.readBigUInt64LE(at + 16)), claimable: coins(d.readBigUInt64LE(at + 24)) };
}
const sol = async (w) => (await rpc("getBalance", [w])).value / 1e9;

function ledger() {
  const db = new DatabaseSync(`${HOME}/ledger-mainnet/ledger.db`, { readOnly: true });
  try {
    const rows = db.prepare("SELECT json FROM rows ORDER BY slot, ix, sub").all().map((r) => JSON.parse(r.json));
    const rounds = db.prepare("SELECT ladder, json FROM rounds").all().map((r) => ({ ladder: r.ladder, ...JSON.parse(r.json) })).sort((a, b) => a.index - b.index);
    return { rows, rounds };
  } finally { db.close(); }
}

const isCall = (x) => x.kind === "buy";
const isPlayer = (x) => ["buy", "sell", "redeem", "claim", "deposit"].includes(x.kind);

function usage(rows, since) {
  const r = rows.filter((x) => x.time >= since && isPlayer(x)), calls = r.filter(isCall);
  const sum = (list, f) => list.reduce((s, x) => s + coins(x[f] ?? 0), 0);
  const firstSeen = new Map();
  for (const x of rows) if (isPlayer(x) && !firstSeen.has(x.wallet)) firstSeen.set(x.wallet, x.time);
  const wallets = new Set(calls.map((x) => x.wallet)), outside = [...wallets].filter((w) => !TEAM[w]);
  return {
    calls: calls.length, wallets: wallets.size, outside: outside.length, volume: sum(calls, "amountIn"), fees: sum(calls, "fee"),
    outsideVolume: sum(calls.filter((x) => !TEAM[x.wallet]), "amountIn"),
    paid: sum(r.filter((x) => x.kind === "redeem" || x.kind === "claim"), "amountOut"),
    sold: sum(r.filter((x) => x.kind === "sell"), "amountOut"),
    deposits: sum(r.filter((x) => x.kind === "deposit"), "amountIn"),
    newWallets: [...firstSeen.values()].filter((t) => t >= since).length, everWallets: firstSeen.size,
  };
}

const eventsSince = (since) => {
  const f = `${HOME}/stook-events-mainnet.log`;
  if (!existsSync(f)) return [];
  const from = new Date(since * 1000).toISOString();
  return readFileSync(f, "utf8").split("\n").filter((l) => l && l.split(" ")[0] >= from);
};

/** The round taking calls or waiting for its bell, and the last one finished. */
function roundsNow(rounds) {
  const open = rounds.filter((r) => !r.settled && !r.voided).at(-1) ?? null, done = rounds.filter((r) => r.settled || r.voided).at(-1) ?? null;
  return { open, done };
}
const priceOf = (r, raw) => Number(raw) * 10 ** (r.expo ?? 0);

/** Each part of the report, read fresh. The scheduled report and the commands share it. */
async function sections() {
  const t = now(), { rows, rounds } = ledger(), day = usage(rows, t - 86_400), all = usage(rows, 0), { open, done } = roundsNow(rounds);
  const [h, kSol, dSol, prices, led, gecko, jup] = await Promise.all([
    safe(house()), safe(sol(KEEPER)), safe(sol(DEPLOY)), safe(getJson(`${SITE}/prices`)), safe(getJson("http://127.0.0.1:8793/health")),
    safe(getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${MINT}`)), safe(getJson(`https://lite-api.jup.ag/tokens/v2/search?query=${MINT}`)),
  ]);
  const inOpen = open ? rows.filter((x) => x.ladder === open.ladder && isCall(x)) : [];
  const ev = eventsSince(t - 86_400), a = gecko?.data?.attributes, px = a ? Number(a.price_usd) : null, usd = (v) => (px ? ` ($${num(v * px)})` : "");
  const state = readState();
  const change = h && state.houseBase ? ` (${h.capital >= state.houseBase ? "+" : ""}${num(h.capital - state.houseBase)} since last report)` : "";
  const posts = safe2(() => readFileSync(`${HOME}/stook-x.log`, "utf8").split("\n").filter((l) => /telegram: posted|new video failed/.test(l)).slice(-1)[0]?.slice(0, 19).replace("T", " "));
  const design = safe2(() => readFileSync(`${HOME}/stook-x.log`, "utf8").split("\n").filter((l) => / video /.test(l)).slice(-1)[0]?.includes("new design"));
  return {
    title: `📊 Stook mainnet, ${new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} New York`,
    trades: [
      "Trades, last 24h",
      `  ${count(day.calls, "call")} from ${count(day.wallets, "wallet")} (${day.outside} outside the team, ${day.newWallets} new)`,
      `  Volume ${num(day.volume)} SSt.${usd(day.volume)}, outside the team ${num(day.outsideVolume)} SSt.`,
      `  Fees ${num(day.fees)} SSt.${usd(day.fees)}, paid out ${num(day.paid + day.sold)} SSt., house deposits ${num(day.deposits)} SSt.`,
      `All time: ${count(all.calls, "call")}, ${count(all.everWallets, "wallet")}, ${num(all.volume)} SSt. volume, ${num(all.fees)} SSt. fees`,
    ],
    rounds: [
      "Rounds",
      open ? `  Open: bell ${nyTime(open.settlesAt)} NY, calls close ${nyTime(open.locksAt)}, ${count(inOpen.length, "call")}, ${num(inOpen.reduce((s, x) => s + coins(x.amountIn ?? 0), 0))} SSt.` : "  ❌ No round open",
      done ? `  Last: ${done.voided ? "VOIDED" : `settled at ${num(priceOf(done, done.settled.price), 2)}`}, ${mins(t - (done.settled?.time ?? done.voided?.time ?? t))}` : "  Last: none yet",
      `  Last 24h: ${ev.filter((l) => l.includes("🟢")).length} opened, ${ev.filter((l) => l.includes("🔔")).length} settled, ${ev.filter((l) => l.includes("⚪")).length} voided`,
    ],
    balances: [
      "Balances",
      ...(h ? [`  House ${num(h.capital)} SSt.${usd(h.capital)}${change}`, `  In the round ${num(h.inRound)}, queued ${num(h.queued)}, claimable ${num(h.claimable)}`] : ["  House: could not read"]),
      `  Keeper ${kSol === null ? "?" : kSol.toFixed(3)} SOL${kSol !== null && kSol < 0.15 ? " ⚠️ LOW" : ""}, deploy wallet ${dSol === null ? "?" : dSol.toFixed(3)} SOL`,
    ],
    market: [
      "Market",
      prices?.STOOK ? `  Polymarket ${num(prices.STOOK.price, 2)} (${(prices.STOOK.change24h ?? 0).toFixed(2)}%), price ${mins(t - prices.STOOK.at)}` : "  ❌ Polymarket price not answering",
      a ? `  SSt. $${Number(a.price_usd).toPrecision(3)}, value $${num(Number(a.fdv_usd))}, 24h volume $${num(Number(a.volume_usd?.h24 ?? 0))}, liquidity $${num(Number(a.total_reserve_in_usd))}${jup?.[0]?.holderCount ? `, ${num(jup[0].holderCount)} holders` : ""}` : "  SSt. market data not answering",
    ],
    systems: [
      "Systems",
      ...Object.entries(SERVICES).map(([u, n]) => `  ${active(u) === "active" ? "✅" : "❌"} ${n}`),
      `  Keeper pass ${mins(ageOf(`${HOME}/ladder-crank-mainnet.beat`))}, all rounds OK ${mins(ageOf(`${HOME}/ladder-crank-mainnet.health`))}`,
      `  Ledger read the chain ${led ? mins(led.pollAge) : "not answering"}`,
      `  Last Telegram post ${posts ?? "?"} UTC, ${design ? "new design" : "⚠️ OLD video"}`,
      `  Box load ${readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ")}, disk ${spawnSync("df", ["--output=pcent", "/"], { encoding: "utf8" }).stdout.split("\n")[1].trim()}`,
    ],
    houseCapital: h?.capital ?? null, state,
  };
}
const fullReport = (s) => [[s.title], s.trades, s.rounds, s.balances, s.market, s.systems].map((p) => p.join("\n")).join("\n\n");

async function report() {
  const s = await sections(), msg = fullReport(s);
  if (s.houseCapital !== null && !printOnly) writeState({ ...s.state, houseBase: s.houseCapital });
  if (printOnly) console.log(msg); else spawnSync(ALERT, ["--report", msg], { stdio: "ignore", timeout: 30_000 });
}
function safe2(f) { try { return f(); } catch { return null; } }

function readState() { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } }
function writeState(s) { writeFileSync(STATE, JSON.stringify(s)); }

const VERB = { buy: "called", sell: "sold back", redeem: "collected", claim: "claimed", deposit: "put in the house" };

async function watch() {
  const t = now(), state = readState(), { rows, rounds } = ledger(), { open, done } = roundsNow(rounds);

  // New trades. The ledger's order: slot, then place in the block.
  const after = (x) => !state.last || x.slot > state.last.slot || (x.slot === state.last.slot && (x.ix > state.last.ix || (x.ix === state.last.ix && x.sub > state.last.sub)));
  const fresh = rows.filter((x) => isPlayer(x) && after(x));
  if (state.last && fresh.length) {
    const seen = new Set(rows.filter((x) => isPlayer(x) && !after(x)).map((x) => x.wallet));
    const lines = fresh.slice(0, 12).map((x) => {
      const amount = coins(x.kind === "buy" || x.kind === "deposit" ? x.amountIn ?? 0 : x.amountOut ?? 0), first = !seen.has(x.wallet) && !TEAM[x.wallet];
      seen.add(x.wallet);
      return `${first ? "🆕 " : ""}${who(x.wallet)} ${VERB[x.kind]} ${num(amount)} SSt.\nsolscan.io/tx/${x.sig}`;
    });
    if (fresh.length > 12) lines.push(`and ${fresh.length - 12} more`);
    const msg = `💸 Stook mainnet\n\n${lines.join("\n\n")}`;
    if (printOnly) console.log(msg); else spawnSync(ALERT, ["--report", msg], { stdio: "ignore", timeout: 30_000 });
  }
  const lastRow = rows.filter(isPlayer).at(-1);

  // Services (the watchdogs restart them; this says so once an hour while it lasts).
  for (const [u, n] of Object.entries(SERVICES)) {
    if (active(u) !== "active") problem(`svc-${u}`, `${n} is ${active(u)}. Check: systemctl status ${u}`);
    else clear(`svc-${u}`, `${n} is running again.`);
  }

  // Rounds failing, though the keeper still passes.
  const sick = ageOf(`${HOME}/ladder-crank-mainnet.health`);
  if (sick > 1800) problem("sick", `keeper rounds have not been OK for ${Math.floor(sick / 60)} min. See ~/ladder-crank-mainnet.log`);
  else clear("sick", "keeper rounds are going through again.");

  // A round past its bell, or none open. The pool's price moves only on a swap, so a settle can wait for one: an hour first.
  if (open && t > open.settlesAt + 3600) problem("settle", `the round's bell was ${Math.floor((t - open.settlesAt) / 60)} min ago and it has not settled. Is the pool quiet, or the keeper stuck?`);
  else clear("settle", "the late round has settled.");
  const doneAt = done?.settled?.time ?? done?.voided?.time ?? 0;
  if (!open && doneAt && t > doneAt + 3600) problem("no-round", `no round is open, ${Math.floor((t - doneAt) / 60)} min after the last one ended. Players can't call.`);
  else if (open) clear("no-round", "a round is open again.");

  // A voided round: once each.
  const voidedAt = rounds.filter((r) => r.voided).map((r) => r.voided.time ?? 0).reduce((a, b) => Math.max(a, b), 0);
  if (state.voidedAt !== undefined && voidedAt > state.voidedAt) alert("--report", "⚪ MAINNET: a round voided. Players get their coins back. See ~/stook-events-mainnet.log");

  // The house: a fall of 10% or more since the last report.
  const h = await safe(house());
  if (h && state.houseBase && h.capital < state.houseBase * 0.9) problem("house", `the house fell ${num(state.houseBase - h.capital)} SSt. since the last report, to ${num(h.capital)}.`);
  else if (h) clear("house", `the house is back to ${num(h.capital)} SSt.`);

  // What players touch. Two misses in a row, so one blip says nothing.
  const site = await safe(getJson(`${SITE}/prices`));
  const proxy = await safe(getJson(PROXY, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }));
  const misses = { site: site?.STOOK ? 0 : (state.misses?.site ?? 0) + 1, proxy: proxy ? 0 : (state.misses?.proxy ?? 0) + 1 };
  if (misses.site >= 2) problem("site", "stookstreet.xyz/prices is not answering.");
  else if (!misses.site) clear("site", "the site answers again.");
  if (misses.proxy >= 2) problem("proxy", "the site's RPC proxy is not answering. Players can't load or trade.");
  else if (!misses.proxy) clear("proxy", "the RPC proxy answers again.");
  if (site?.STOOK && t - site.STOOK.at > 6 * 3600) problem("price", `the Polymarket price is ${Math.floor((t - site.STOOK.at) / 3600)} h old.`);
  else if (site?.STOOK) clear("price", "the Polymarket price is moving again.");

  // A daily post that fell back to the old video.
  const tail = safe2(() => readFileSync(`${HOME}/stook-x.log`, "utf8").split("\n").filter((l) => l.includes("new video failed")).slice(-1)[0]);
  if (tail && tail !== state.videoFail && state.last) alert("--report", `⚠️ MAINNET: today's daily video fell back to the old one.\n${tail.slice(0, 300)}`);

  if (!printOnly) writeState({ ...state, last: lastRow ? { slot: lastRow.slot, ix: lastRow.ix, sub: lastRow.sub } : state.last ?? { slot: 0, ix: 0, sub: 0 }, voidedAt, misses, videoFail: tail ?? state.videoFail, houseBase: state.houseBase ?? h?.capital });
  else console.log("watch ok", { rows: rows.length, fresh: fresh.length, open: open?.ladder?.slice(0, 6), sickAge: sick, house: h?.capital, misses });
}

const HELP = [
  "Stook mainnet",
  "/status  the full report",
  "/trades [n]  the last trades, with links (10, at most 20)",
  "/wallets  who has played, by volume",
  "/rounds  the open round and the last five",
  "/balances  the house and our wallets",
  "/market  Polymarket and SSt.",
  "/systems  services, keeper, ledger, posts, box",
  "/help  this list",
].join("\n");

function tradesText(n) {
  const list = ledger().rows.filter(isPlayer).slice(-n).reverse();
  if (!list.length) return "No trades yet.";
  return [`Last ${count(list.length, "trade")}, newest first`, ...list.map((x) => `${nyTime(x.time)} NY: ${who(x.wallet)} ${VERB[x.kind]} ${num(coins(x.kind === "buy" || x.kind === "deposit" ? x.amountIn ?? 0 : x.amountOut ?? 0))} SSt.\nsolscan.io/tx/${x.sig}`)].join("\n\n");
}

function walletsText() {
  const by = new Map();
  for (const x of ledger().rows.filter(isPlayer)) {
    const w = by.get(x.wallet) ?? { wallet: x.wallet, calls: 0, volume: 0, paid: 0, last: 0 };
    if (isCall(x)) { w.calls += 1; w.volume += coins(x.amountIn ?? 0); }
    if (["sell", "redeem", "claim"].includes(x.kind)) w.paid += coins(x.amountOut ?? 0);
    w.last = Math.max(w.last, x.time);
    by.set(x.wallet, w);
  }
  const list = [...by.values()].sort((a, b) => b.volume - a.volume), outside = list.filter((w) => !TEAM[w.wallet]).length;
  if (!list.length) return "No wallets yet.";
  return [`${count(list.length, "wallet")}, ${outside} outside the team`, ...list.slice(0, 15).map((w) => `${who(w.wallet)}: ${count(w.calls, "call")}, ${num(w.volume)} SSt. in, ${num(w.paid)} SSt. out, last ${nyTime(w.last)} NY\nsolscan.io/account/${w.wallet}`)].join("\n\n");
}

function pastRounds() {
  const { rows, rounds } = ledger(), past = rounds.filter((r) => r.settled || r.voided).slice(-5).reverse();
  if (!past.length) return "Finished rounds: none yet";
  return ["Finished rounds", ...past.map((r) => { const calls = rows.filter((x) => x.ladder === r.ladder && isCall(x)); return `  ${nyTime(r.settlesAt)} NY: ${r.voided ? "VOIDED" : `settled at ${num(priceOf(r, r.settled.price), 2)}`}, ${count(calls.length, "call")}, ${num(calls.reduce((s, x) => s + coins(x.amountIn ?? 0), 0))} SSt.`; })].join("\n");
}

/** The answer to one line from the chat. Reads only: no state, no key. */
async function answer(text) {
  const [word, arg] = text.trim().toLowerCase().split(/\s+/), cmd = word.replace(/@.*$/, "");
  const part = async (name) => (await sections())[name].join("\n");
  switch (cmd) {
    case "/status": return fullReport(await sections());
    case "/trades": return tradesText(Math.min(20, Math.max(1, parseInt(arg, 10) || 10)));
    case "/wallets": return walletsText();
    case "/rounds": return `${await part("rounds")}\n\n${pastRounds()}`;
    case "/balances": return part("balances");
    case "/market": return part("market");
    case "/systems": return part("systems");
    default: return HELP;
  }
}

/** Long-polls Telegram and answers one chat only (TG_CHAT_ID). Anyone else gets no reply. */
async function bot() {
  const { TG_BOT_TOKEN: token, TG_CHAT_ID: chat } = process.env;
  if (!token || !chat) throw new Error("TG_BOT_TOKEN and TG_CHAT_ID are required");
  const tg = (method, body, ms = 30_000) => fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }).then((r) => r.json());
  const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
  const commands = HELP.split("\n").slice(1).map((l) => { const [c, ...rest] = l.split(/\s+/); return { command: c.slice(1), description: rest.join(" ") }; });
  // The old bot's menu goes; this one shows in this chat only.
  await tg("deleteMyCommands", {});
  await tg("setMyCommands", { commands, scope: { type: "chat", chat_id: chat } });
  // What was sent while the bot was down is not answered late.
  const pending = await tg("getUpdates", { offset: -1, timeout: 0 });
  let offset = pending.result?.at(-1)?.update_id + 1 || 0;
  log("bot up");
  for (;;) {
    try {
      const r = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }, 70_000);
      if (!r.ok) { log(`getUpdates: ${r.error_code} ${r.description}`); await new Promise((d) => setTimeout(d, 10_000)); continue; }
      for (const u of r.result) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m?.text || String(m.chat.id) !== String(chat)) continue;
        log(m.text.split(/\s+/)[0].slice(0, 20));
        const text = await answer(m.text).catch((e) => { log(`failed: ${e.message}`); return "Could not build that. See ~/stook-bot.log on the box."; });
        await tg("sendMessage", { chat_id: chat, text: text.length > 4000 ? `${text.slice(0, 3990)}\n…` : text, disable_web_page_preview: true });
      }
    } catch (e) { log(`poll: ${e.name}`); await new Promise((d) => setTimeout(d, 5_000)); }
  }
}

if (mode === "report") await report();
else if (mode === "watch") await watch();
else if (mode === "bot") await bot();
else if (mode === "ask") console.log(await answer(flags.join(" ")));
else { console.error("usage: monitor.mjs report|watch [--print] | bot | ask /command"); process.exit(2); }

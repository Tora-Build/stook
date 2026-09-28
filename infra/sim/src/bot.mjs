// The box's Telegram control panel: answers commands from one chat only
// (TG_CHAT_ID), through TG_BOT_TOKEN, both from ~/stook-alerts.env.
//   node src/bot.mjs            long-polls Telegram (stook-tgbot.service)
//
//   /status            services, keeper, wallet, tape, resolver, box
//   /fleet             the simulated fleet: today's actions, SOL, wallets
//   /activity [n]      the fleet's last n actions (default 15)
//   /issues            unexpected failures the fleet has met
//   /rounds            today's and tomorrow's round for each coin
//   /wallet <n>        one fleet wallet: persona, SOL, coins, holdings
//   /pause, /resume    stop or start the fleet
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Keypair, PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { COINS, loadConfig } from "./config.mjs";
import { createReader, makeConnection, readWallets } from "./chain.mjs";
import { RpcBucket } from "./rate.mjs";

const run = promisify(execFile);
const HOME = homedir();
const SIM = process.env.SIM_DIR ?? join(HOME, "sim");
const { TG_BOT_TOKEN: TOKEN, TG_CHAT_ID: CHAT } = process.env;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SITE = "https://stookstreet.xyz";

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ny = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const nyTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const lines = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);
const json = (path, fallback) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } };
const coinsOf = (units, decimals) => (Number(units) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 2 });

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(70_000) });
  return r.json();
}
const reply = (text) => tg("sendMessage", { chat_id: CHAT, text: text.length > 4000 ? text.slice(0, 3990) + "\n…" : text, parse_mode: "HTML", disable_web_page_preview: true });

// Chain reads go through their own small budget: the keeper comes first.
const cfg = loadConfig();
const conn = makeConnection(cfg.rpcUrl, new RpcBucket(2));
const reader = createReader({ conn, coins: COINS.map((c) => ({ ...c, mint: cfg.mints?.[c.symbol] ?? null })), siteUrl: cfg.siteUrl ?? SITE });

const sinceMidnightNY = () => {
  const d = new Date(), p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const nyDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function status() {
  const { stdout } = await run("bash", [join(HOME, "stook/infra/vps/health.sh"), "--print"], { timeout: 60_000 }).catch((e) => ({ stdout: `health check failed: ${e.message}` }));
  return esc(stdout.trim());
}

async function fleet() {
  const active = await run("systemctl", ["is-active", "stook-sim"]).then((r) => r.stdout.trim()).catch((e) => e.stdout?.trim() || "unknown");
  const today = sinceMidnightNY();
  const acts = lines(join(SIM, "actions.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const todays = acts.filter((a) => nyDay(a.at) === today);
  const by = {};
  for (const a of todays) {
    const o = (by[a.action] ??= { ok: 0, skip: 0, expected: 0, unexpected: 0 });
    if (a.error) o[a.kind === "unexpected" ? "unexpected" : "expected"]++;
    else if (a.skip) o.skip++;
    else o.ok++;
  }
  const state = json(join(SIM, "state.json"), {});
  const journal = json(join(SIM, "journal.json"), { wallets: {} });
  const ws = Object.values(journal.wallets ?? {});
  const withCoins = ws.filter((w) => w.faucetDay).length;
  const positions = ws.reduce((n, w) => n + (w.positions?.length ?? 0), 0), tranches = ws.reduce((n, w) => n + (w.tranches?.length ?? 0), 0);
  const issues = lines(join(SIM, "issues.jsonl")).length;
  let treasury = "?";
  try {
    const k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(cfg.treasury, "utf8"))));
    treasury = ((await conn.getBalance(k.publicKey)) / 1e9).toFixed(2);
  } catch { /* shown as ? */ }
  const spent = state.sol?.day === new Date().toISOString().slice(0, 10) ? Number(BigInt(state.sol.spent ?? 0)) / 1e9 : 0;
  const rows = Object.entries(by).sort().map(([k, o]) => `${k.padEnd(8)} ${String(o.ok).padStart(4)} ok ${String(o.skip).padStart(4)} skip ${String(o.expected).padStart(3)} exp ${String(o.unexpected).padStart(3)} bad`).join("\n");
  const last = acts.at(-1);
  return [
    `<b>🤖 Fleet</b>: ${active === "active" ? "✅ running" : `❌ ${esc(active)}`}, ${cfg.wallets} wallets, cap ${cfg.txPerMin} tx/min`,
    `Wallets with test coins: ${withCoins}`,
    `Holding now: ${positions} lines, ${tranches} house deposits`,
    `Treasury: ${treasury} SOL · sent today ${spent.toFixed(2)} of ${cfg.dailySol} SOL`,
    `Unexpected issue kinds: ${issues}${issues ? " (/issues)" : ""}`,
    "",
    `<b>Today (New York)</b>, ${todays.length} actions:`,
    rows ? `<pre>${esc(rows)}</pre>` : "nothing yet",
    last ? `Last: ${esc(nyTime(last.at))}, #${esc(last.wallet)} ${esc(last.persona)} ${esc(last.action)}${last.coin ? " " + esc(last.coin) : ""}` : "",
  ].join("\n");
}

function describe(a) {
  const p = a.params ?? {};
  const what = a.action === "buy" ? `buy ${p.shape ?? ""} ${p.spend ? `spend ${p.spend}` : ""}`
    : a.action === "sell" ? `sell ${p.pct ? p.pct + "%" : ""}`
    : a.action === "join" ? `house deposit ${p.deposit ?? ""}`
    : a.action === "start" ? `fund round ${p.index ?? ""}`
    : a.action;
  const result = a.error ? `❌ ${a.error}` : a.skip ? `⏭ ${a.skip}` : "✅";
  const link = a.sig ? ` <a href="https://explorer.solana.com/tx/${a.sig}?cluster=devnet">tx</a>` : "";
  return `${esc(nyTime(a.at))} #${esc(a.wallet)} ${esc(a.persona)} · ${esc(what.trim())}${a.coin ? " " + esc(a.coin) : ""} ${esc(result).slice(0, 140)}${link}`;
}

function activity(n) {
  const acts = lines(join(SIM, "actions.jsonl")).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!acts.length) return "No fleet activity yet.";
  return `<b>Last ${acts.length} fleet actions</b> (New York time)\n` + acts.map(describe).join("\n");
}

function issues() {
  const book = lines(join(SIM, "issues.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!book.length) return "✅ No unexpected failures so far.";
  return `<b>Unexpected failures</b> (${book.length} kinds)\n\n` + book.sort((a, b) => b.count - a.count).slice(0, 12)
    .map((i) => `• <b>${esc(i.name)}</b> ×${i.count}, last ${esc(ny(i.lastSeen))}\n  ${esc(String(i.example?.message ?? i.signature ?? "").slice(0, 200))}`).join("\n");
}

async function rounds() {
  const w = await reader.world();
  const one = (c, label, r) => {
    if (!r?.round) return `  ${label}: not funded yet`;
    const l = r.round.l, d = l.decimals;
    const bell = new Date(Number(l.settlesAt) * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
    return `  ${label}: <a href="${SITE}/m/${r.key.toBase58()}">${esc(l.status)}</a>, house ${coinsOf(l.depositTotal, d)}, calls in ${coinsOf(l.basisTotal, d)}, ${l.openPositions} lines, ${l.openTranches} deposits, bell ${esc(bell)}`;
  };
  return "<b>Rounds</b>\n" + w.coins.map((c) => `\n<b>${esc(c.symbol)}</b>\n${one(c, "today", c.today)}\n${one(c, "tomorrow", c.tomorrow)}`).join("\n");
}

async function wallet(n) {
  const row = lines(join(SIM, "wallets.txt")).find((l) => l.split("\t")[0] === String(n));
  if (!row) return `No fleet wallet #${esc(n)}.`;
  const [, key, persona, size] = row.split("\t");
  const [bal] = await readWallets(conn, [new PublicKey(key)], (await reader.world()).coins).catch(() => [null]);
  const j = json(join(SIM, "journal.json"), { wallets: {} }).wallets?.[n] ?? {};
  const acts = lines(join(SIM, "actions.jsonl")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((a) => a && String(a.wallet) === String(n)).slice(-8);
  const dec = Object.fromEntries(COINS.map((c) => [c.symbol, c.decimals]));
  const coins = bal ? Object.entries(bal.coins ?? {}).map(([k, v]) => `${k} ${coinsOf(v, dec[k] ?? 0)}`).join(", ") : "?";
  return [
    `<b>Wallet #${esc(n)}</b>: ${esc(persona)}, ${esc(size)} sizes`,
    `<a href="https://explorer.solana.com/address/${key}?cluster=devnet">${esc(key.slice(0, 8))}…</a>`,
    `SOL: ${bal ? (Number(bal.lamports) / 1e9).toFixed(3) : "?"}`,
    `Coins: ${esc(coins)}`,
    `Holding: ${j.positions?.length ?? 0} lines, ${j.tranches?.length ?? 0} house deposits`,
    "", acts.length ? "<b>Recent</b>\n" + acts.map(describe).join("\n") : "No actions yet.",
  ].join("\n");
}

async function control(verb) {
  await run("sudo", ["-n", "systemctl", verb === "pause" ? "stop" : "start", "stook-sim"], { timeout: 120_000 });
  const s = await run("systemctl", ["is-active", "stook-sim"]).then((r) => r.stdout.trim()).catch((e) => e.stdout?.trim() || "unknown");
  return verb === "pause" ? `⏸ Fleet paused (${esc(s)}). /resume to start it again.` : `▶️ Fleet ${s === "active" ? "running" : esc(s)}.`;
}

const HELP = `<b>Stook Street box</b>
/status services, keeper, wallet, prices, box
/fleet the simulated fleet today
/activity [n] its last n actions
/issues unexpected failures it met
/rounds today's and tomorrow's rounds
/wallet &lt;n&gt; one fleet wallet
/pause, /resume stop or start the fleet`;

async function handle(text) {
  const [cmd, arg] = text.trim().split(/\s+/);
  switch (cmd.replace(/@.*$/, "").toLowerCase()) {
    case "/start": case "/help": return HELP;
    case "/status": return status();
    case "/fleet": return fleet();
    case "/activity": return activity(Math.min(40, Math.max(1, Number(arg) || 15)));
    case "/issues": return issues();
    case "/rounds": return rounds();
    case "/wallet": return arg ? wallet(arg) : "Which one? /wallet 12";
    case "/pause": return control("pause");
    case "/resume": return control("resume");
    default: return null;
  }
}

async function main() {
  // `node src/bot.mjs --print /fleet`: one answer as plain text (the daily report uses it).
  const pi = process.argv.indexOf("--print");
  if (pi > 0) {
    const out = String((await handle(process.argv.slice(pi + 1).join(" "))) ?? "");
    console.log(out.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    process.exit(0);
  }
  // `node src/bot.mjs --selftest`: every command's answer to the terminal, nothing sent.
  if (process.argv.includes("--selftest")) {
    for (const c of ["/help", "/status", "/fleet", "/activity 5", "/issues", "/rounds", "/wallet 3"]) console.log(`\n===== ${c}\n${await handle(c).catch((e) => "ERROR " + e.stack)}`);
    process.exit(0);
  }
  if (!TOKEN || !CHAT) { console.error("TG_BOT_TOKEN and TG_CHAT_ID are needed (~/stook-alerts.env)"); process.exit(2); }
  await tg("setMyCommands", { commands: [
    { command: "status", description: "Services, keeper, wallet, prices, box" },
    { command: "fleet", description: "The simulated fleet today" },
    { command: "activity", description: "The fleet's last actions" },
    { command: "issues", description: "Unexpected failures the fleet met" },
    { command: "rounds", description: "Today's and tomorrow's rounds" },
    { command: "wallet", description: "One fleet wallet: /wallet 12" },
    { command: "pause", description: "Stop the fleet" },
    { command: "resume", description: "Start the fleet" },
  ] }).catch(() => {});
  let offset = 0;
  for (;;) {
    let r;
    try { r = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }); }
    catch { await new Promise((ok) => setTimeout(ok, 5_000)); continue; }
    for (const u of r.result ?? []) {
      offset = u.update_id + 1;
      const m = u.message;
      // One chat only: everyone else is ignored without an answer.
      if (!m?.text || String(m.chat?.id) !== String(CHAT)) continue;
      try { const out = await handle(m.text); if (out) await reply(out); }
      catch (e) { await reply(`⚠️ ${esc(e.message ?? e)}`).catch(() => {}); }
    }
    if (!r.ok) await new Promise((ok) => setTimeout(ok, 5_000));
  }
}

main();

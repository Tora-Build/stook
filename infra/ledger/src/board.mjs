// The leaderboard: the street's sharpest callers in one coin, from the same
// rows and round summaries as each wallet's history.
//
// A wallet's record counts the rounds where it made a call and the round
// settled. Each such round is a win when a call paid (collected or still to
// collect) and a miss when none did. Its net is what came back plus what is
// still owed, less what went in. Voided rounds were refunded and count for
// nothing; a round whose floor the ledger never saw cannot be scored and is
// left out. House deposits are not calls.
//
// Wallets the sim runs (its list, ~/sim/wallets.txt) are marked as bots with
// their persona, so the app can show or hide them.
//
// Season points rank callers across every coin, where nets in different
// coins cannot be added: 10 for each scored round, 30 more when a call paid,
// and 1 more for each 5% the round returned on what went in, up to 60. So a
// round is worth 10 to 100 points whatever its size or coin. Weeks end at
// the Friday bell (4 PM New York), the board's prize weeks.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { summarize } from "./history.mjs";

export const BOARD_MAX = 100;
/** Every coin at once, ranked by points. */
export const ALL = "ALL";
export const SEASON = { name: "Season 0", from: 0 };
const PLAYED = 10, WON = 30, EDGE_MAX = 60, EDGE_STEP_BPS = 500n;

/** A scored round's points: 10 to 100. */
export function pointsFor({ won, paid, back }) {
  let edge = 0;
  if (back > paid && paid > 0n) edge = Number(((back - paid) * 10_000n) / paid / EDGE_STEP_BPS);
  return PLAYED + (won ? WON : 0) + Math.min(EDGE_MAX, edge);
}

/** The New York wall-clock offset from UTC at `t`, in seconds (−4 h or −5 h). */
function nyOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000 - t;
}

/** The Friday bell (16:00 New York) at or after `t`. */
export function fridayBellAfter(t) {
  const local = t + nyOffset(t);
  const d = new Date(local * 1000);
  const ahead = (5 - d.getUTCDay() + 7) % 7;
  let bell = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ahead, 16) / 1000;
  bell -= nyOffset(bell - 5 * 3600); // the offset in force that afternoon
  return bell < t ? fridayBellAfter(t + 86_400) : bell;
}

/** Prize week `n` back from the one running at `now` (0): settled rounds in (from, to]. */
export function weekOf(n, now) {
  let to = fridayBellAfter(now);
  for (let i = 0; i < n; i++) to = fridayBellAfter(to - 7 * 86_400 - 3600);
  return { n, from: fridayBellAfter(to - 7 * 86_400 - 3600), to };
}

/** {wallet: persona} for the sim's fleet, from LEDGER_BOTS (a path) or SIM_DIR/wallets.txt. */
export function loadBots(env = process.env) {
  const path = env.LEDGER_BOTS || join(env.SIM_DIR ?? join(homedir(), "sim"), "wallets.txt");
  const out = new Map();
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const [, key, persona] = line.split("\t");
      if (key) out.set(key, persona || "bot");
    }
  } catch { /* no sim on this machine */ }
  return out;
}

/**
 * Every wallet's scored rounds, every coin: Map wallet → [{ ladder, coin,
 * settlesAt, won, paid, back, decimals }]. The slow part (a summary per
 * round); `rankBoard` then answers any coin and period from it at once.
 */
export function scoreAll({ walletRows, round, series, coins, now = Math.floor(Date.now() / 1000) }) {
  const out = new Map();
  for (const [wallet, rows] of walletRows) {
    const byLadder = new Map();
    for (const x of rows) { const l = byLadder.get(x.ladder) ?? []; l.push(x); byLadder.set(x.ladder, l); }
    const scored = [];
    for (const [ladder, rs] of byLadder) {
      if (!rs.some((x) => x.kind === "buy")) continue;
      const r = round(ladder);
      const s = summarize(ladder, rs, r, r?.series ? series(r.series) : null, coins, now);
      if (s.status !== "settled") continue;
      const owed = BigInt(s.owed ?? 0);
      // "unclaimed" with nothing known to be owed: the floor is unknown
      if (s.result === "unclaimed" && owed === 0n) continue;
      if (!["won", "missed", "unclaimed"].includes(s.result)) continue;
      const x = { ladder, coin: s.coin, quoteMint: s.quoteMint, settlesAt: s.settlesAt ?? 0, won: s.result === "won" || owed > 0n, paid: BigInt(s.paid), back: BigInt(s.got) + owed, decimals: s.decimals };
      scored.push({ ...x, points: pointsFor(x) });
    }
    if (scored.length) out.set(wallet, scored);
  }
  return out;
}

/**
 * The board for one coin: every wallet with at least one scored round in
 * (`since`, `until`], best net first (then the better hit rate, then more
 * rounds). For `ALL`, every coin, most points first; each caller's net is
 * then kept per coin, as the coins cannot be added.
 */
export function rankBoard(scored, { bots = new Map(), coin, since = 0, until = Infinity, limit = 50 }) {
  const all = coin === ALL;
  const players = [];
  let decimals = null;
  for (const [wallet, rounds] of scored) {
    const rs = rounds.filter((x) => (all || x.coin === coin || x.quoteMint === coin) && x.settlesAt > since && x.settlesAt <= until);
    if (!rs.length) continue;
    let paid = 0n, back = 0n, won = 0, best = null, last = 0, points = 0;
    const coins = {};
    for (const x of rs) {
      paid += x.paid; back += x.back; points += x.points; if (x.won) won++;
      const net = x.back - x.paid;
      if (best === null || net > best) best = net;
      if (x.settlesAt > last) last = x.settlesAt;
      if (decimals === null && x.decimals !== null && x.decimals !== undefined) decimals = x.decimals;
      const c = (coins[x.coin ?? x.quoteMint] ??= { net: 0n, decimals: x.decimals ?? null });
      c.net += net;
    }
    players.push({ wallet, bot: bots.get(wallet) ?? null, rounds: rs.length, won, missed: rs.length - won, hit: won / rs.length, paid, back, net: back - paid, best, last, points, coins });
  }
  const byNet = (a, b) => (a.net === b.net ? b.hit - a.hit || b.rounds - a.rounds : a.net < b.net ? 1 : -1);
  players.sort(all ? (a, b) => b.points - a.points || b.hit - a.hit || b.rounds - a.rounds : byNet);
  const entry = (p, n) => ({
    rank: n + 1, wallet: p.wallet, bot: p.bot, rounds: p.rounds, won: p.won, missed: p.missed,
    hit: Math.round(p.hit * 1000) / 1000, points: p.points, last: p.last,
    ...(all
      ? { coins: Object.fromEntries(Object.entries(p.coins).map(([k, c]) => [k, { net: String(c.net), decimals: c.decimals }])) }
      : { paid: String(p.paid), back: String(p.back), net: String(p.net), best: String(p.best) }),
  });
  const n = Math.min(limit, BOARD_MAX);
  const people = players.filter((p) => !p.bot);
  // People ranked among themselves too, so a page that hides the bots still
  // has a full board.
  return { coin, decimals: all ? null : decimals, since, until: Number.isFinite(until) ? until : null, players: players.length, people: people.length, board: players.slice(0, n).map(entry), peopleBoard: people.slice(0, n).map(entry) };
}

/** Score and rank in one go (tests, one-off reads). */
export const buildBoard = ({ walletRows, round, series, coins, now, ...opts }) => rankBoard(scoreAll({ walletRows, round, series, coins, now }), opts);

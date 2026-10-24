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

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { summarize } from "./history.mjs";

export const BOARD_MAX = 100;

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
      scored.push({ ladder, coin: s.coin, quoteMint: s.quoteMint, settlesAt: s.settlesAt ?? 0, won: s.result === "won" || owed > 0n, paid: BigInt(s.paid), back: BigInt(s.got) + owed, decimals: s.decimals });
    }
    if (scored.length) out.set(wallet, scored);
  }
  return out;
}

/**
 * The board for one coin: every wallet with at least one scored round since
 * `since`, best net first (then the better hit rate, then more rounds).
 */
export function rankBoard(scored, { bots = new Map(), coin, since = 0, limit = 50 }) {
  const players = [];
  let decimals = null;
  for (const [wallet, all] of scored) {
    const rs = all.filter((x) => (x.coin === coin || x.quoteMint === coin) && x.settlesAt >= since);
    if (!rs.length) continue;
    let paid = 0n, back = 0n, won = 0, best = null, last = 0;
    for (const x of rs) {
      paid += x.paid; back += x.back; if (x.won) won++;
      const net = x.back - x.paid;
      if (best === null || net > best) best = net;
      if (x.settlesAt > last) last = x.settlesAt;
      if (decimals === null && x.decimals !== null && x.decimals !== undefined) decimals = x.decimals;
    }
    players.push({ wallet, bot: bots.get(wallet) ?? null, rounds: rs.length, won, missed: rs.length - won, hit: won / rs.length, paid, back, net: back - paid, best, last });
  }
  players.sort((a, b) => (a.net === b.net ? b.hit - a.hit || b.rounds - a.rounds : a.net < b.net ? 1 : -1));
  const entry = (p, n) => ({
    rank: n + 1, wallet: p.wallet, bot: p.bot, rounds: p.rounds, won: p.won, missed: p.missed,
    hit: Math.round(p.hit * 1000) / 1000, paid: String(p.paid), back: String(p.back), net: String(p.net), best: String(p.best), last: p.last,
  });
  const n = Math.min(limit, BOARD_MAX);
  const people = players.filter((p) => !p.bot);
  // People ranked among themselves too, so a page that hides the bots still
  // has a full board.
  return { coin, decimals, since, players: players.length, people: people.length, board: players.slice(0, n).map(entry), peopleBoard: people.slice(0, n).map(entry) };
}

/** Score and rank in one go (tests, one-off reads). */
export const buildBoard = ({ walletRows, round, series, coins, now, ...opts }) => rankBoard(scoreAll({ walletRows, round, series, coins, now }), opts);

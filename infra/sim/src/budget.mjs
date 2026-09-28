// The treasury's daily allowance. Everything it sends out in a UTC day,
// top-ups and its own fees, counts against SIM_DAILY_SOL, less what the
// fleet sends back the same day, so the cap is on net outflow. The day's net
// is kept in state.json so a restart does not reset it, with the last 14
// days' nets behind it for the runway. A top-up is booked before it is sent
// and given back only when it surely did not land, so a crash or a restart
// mid-send can never let spend go unbooked.

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 14;

export class SolBudget {
  /** `state` is the persisted object ({ day, spent, history } in lamports); `save` writes it. */
  constructor(dailyLamports, state = {}, save = () => {}) {
    this.daily = BigInt(Math.floor(dailyLamports));
    this.state = state; this.save = save;
  }
  // A new day files the last one's net in the history, the newest 14 kept.
  #roll(ms) {
    const day = utcDay(ms);
    if (this.state.day === day) return;
    if (this.state.day && this.state.day < day) {
      const h = (this.state.history ??= []).filter((x) => x.day !== this.state.day);
      h.push({ day: this.state.day, net: this.state.spent ?? "0" });
      this.state.history = h.sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-HISTORY_DAYS);
    }
    this.state.day = day; this.state.spent = "0";
  }
  spent(ms = Date.now()) { this.#roll(ms); return BigInt(this.state.spent ?? "0"); }
  remaining(ms = Date.now()) { const r = this.daily - this.spent(ms); return r > 0n ? r : 0n; }
  /** Book `lamports` against today. Refuses (false) what would pass the cap. */
  spend(lamports, ms = Date.now()) {
    const l = BigInt(lamports);
    if (l > this.remaining(ms)) return false;
    this.state.spent = (this.spent(ms) + l).toString();
    this.save(this.state);
    return true;
  }
  /** Book `lamports` before a send: a receipt for `release`, or null past the cap. */
  reserve(lamports, ms = Date.now()) {
    return this.spend(lamports, ms) ? { day: utcDay(ms), lamports: BigInt(lamports) } : null;
  }
  /** Book `lamports` the treasury paid whatever the cap: the fee on a send that brings SOL back. */
  charge(lamports, ms = Date.now()) {
    const l = BigInt(lamports);
    if (l <= 0n) return;
    this.state.spent = (this.spent(ms) + l).toString();
    this.save(this.state);
  }
  /** SOL the fleet sent back: today's net goes down by it, never below zero. */
  credit(lamports, ms = Date.now()) {
    const l = BigInt(lamports);
    if (l <= 0n) return;
    const left = this.spent(ms) - l;
    this.state.spent = (left > 0n ? left : 0n).toString();
    this.save(this.state);
  }
  /** The last 14 days' nets, oldest first, lamports. */
  history(ms = Date.now()) { this.#roll(ms); return (this.state.history ?? []).map((x) => ({ day: x.day, net: BigInt(x.net) })); }
  /** Give back what a receipt booked that did not go out; only on the day it was booked. */
  release(receipt, lamports = receipt.lamports, ms = Date.now()) {
    const l = BigInt(lamports);
    if (l <= 0n || utcDay(ms) !== receipt.day) return;
    const left = this.spent(ms) - l;
    this.state.spent = (left > 0n ? left : 0n).toString();
    this.save(this.state);
  }
}

/**
 * Which wallets to top up and by how much: every wallet under `min` back up
 * to `target`, poorest first, while the day's allowance (less `feeReserve`
 * per transaction of `perTx` transfers) lasts. Balances in lamports.
 */
export function planTopUps(balances, { min, target, remaining, perTx = 20, feePerTx = 10_000n }) {
  const lo = BigInt(min), hi = BigInt(target);
  let left = BigInt(remaining);
  const out = [];
  const needy = balances.map((b, i) => ({ i, b: BigInt(b) })).filter((x) => x.b < lo).sort((a, b) => (a.b < b.b ? -1 : a.b > b.b ? 1 : a.i - b.i));
  for (const { i, b } of needy) {
    const fee = out.length % perTx === 0 ? BigInt(feePerTx) : 0n;
    const amount = hi - b;
    if (amount + fee > left) break;
    left -= amount + fee;
    out.push({ index: i, lamports: amount });
  }
  return out;
}

/**
 * Which active wallets send SOL back, and how much: every one over
 * `reclaim` returns what it holds above `target`, richest first, `perTx` to
 * a transaction. Balances in lamports, as `[{ index, lamports }]`.
 */
export function planReclaims(balances, { reclaim, target, perTx = 6 }) {
  const hi = BigInt(reclaim), keep = BigInt(target);
  const rows = balances.filter((x) => BigInt(x.lamports) > hi).sort((a, b) => (BigInt(a.lamports) > BigInt(b.lamports) ? -1 : BigInt(a.lamports) < BigInt(b.lamports) ? 1 : a.index - b.index));
  return chunks(rows.map((x) => ({ index: x.index, lamports: BigInt(x.lamports) - keep })), perTx);
}

/** `list` in runs of `n`. */
export function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * The fee a transaction pays: 5,000 lamports a signature and the priority
 * fee on the compute it asks for.
 */
export function feeFor(signatures, computeUnits, priorityMicroLamports = 0) {
  return 5_000n * BigInt(signatures) + (BigInt(computeUnits) * BigInt(Math.round(priorityMicroLamports)) + 999_999n) / 1_000_000n;
}

/**
 * How long the treasury lasts at the recent net spend: the mean of the last
 * seven whole days (days the fleet did not run count as zero, from the first
 * day on record); with none on record yet, today's so far spread over the
 * whole day. `days` is null when nothing is going out.
 */
export function runway(treasuryLamports, { history = [], spentToday = 0n, ms = Date.now() }) {
  const today = utcDay(ms);
  const from = utcDay(ms - 7 * DAY_MS);
  const recent = history.filter((x) => x.day >= from && x.day < today);
  let perDay;
  if (recent.length) {
    const first = recent.reduce((a, x) => (x.day < a ? x.day : a), today);
    const span = Math.min(7, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS));
    perDay = Number(recent.reduce((a, x) => a + BigInt(x.net), 0n)) / Math.max(1, span);
  } else {
    const elapsed = (ms - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
    perDay = Number(BigInt(spentToday)) / Math.max(elapsed, 1 / 24);
  }
  return { perDayLamports: Math.round(perDay), days: perDay > 0 ? Number(treasuryLamports) / perDay : null };
}

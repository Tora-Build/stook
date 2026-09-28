// The treasury's daily allowance. Everything it sends out in a UTC day,
// top-ups and its own fees, counts against SIM_DAILY_SOL, and the day's
// spend is kept in state.json so a restart does not reset it. A top-up is
// booked before it is sent and given back only when it surely did not land,
// so a crash or a restart mid-send can never let spend go unbooked.

export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export class SolBudget {
  /** `state` is the persisted object ({ day, spent } in lamports); `save` writes it. */
  constructor(dailyLamports, state = {}, save = () => {}) {
    this.daily = BigInt(Math.floor(dailyLamports));
    this.state = state; this.save = save;
  }
  #roll(ms) {
    const day = utcDay(ms);
    if (this.state.day !== day) { this.state.day = day; this.state.spent = "0"; }
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

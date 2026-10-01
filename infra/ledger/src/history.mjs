// A wallet's history: its rows grouped by round, each round summed up and
// given a result, newest close first, a page at a time.
//
// Amounts stay in base units of each round's coin, as strings: coins do not
// add up, so the totals are per coin and the app sums them in dollars.
//
// Results:
//   open       the round has not settled or voided yet
//   unclaimed  finished, and something is still owed to the wallet: a call
//              that pays, a void refund, or a house deposit not yet claimed
//   refunded   voided, everything refunded
//   won        settled, and a call paid (a house-only round: got back more
//              than it put in)
//   missed     settled, and nothing it called paid

export const BINS = 64;
const LAST = BINS - 1;
export const RESULTS = ["won", "missed", "refunded", "open", "unclaimed"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** What one share of a shape pays if `bin` settles (the program's `Shape::level`). */
export const level = (s, i) => (i < s.lo || i > s.hi ? 0 : Math.min(s.h, i - s.lo + 1, s.hi - i + 1));

/** The price at the bottom of floor `k` (the SDK's binBounds), in display units. */
function edge(grid, k) {
  const i = clamp(k, 1, LAST);
  return Number(grid.p0) * Math.exp(((i - BINS / 2) * grid.stepBps) / 10_000) * 10 ** grid.expo;
}
const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** A call by name, as the app's rack writes it (lib/call.ts callShort):
 *  "Near 65,000 ±3", "Between 64,321 and 65,457", "Above 67,080". */
export function callName(shape, grid, dp) {
  const near = shape.h > 1;
  if (!grid || !(Number(grid.p0) > 0)) return near ? `Near floor ${(shape.lo + shape.hi) / 2} ±${shape.h - 1}` : shape.lo === shape.hi ? `Floor ${shape.lo}` : `Floors ${shape.lo} to ${shape.hi}`;
  const f = (k) => fmt(edge(grid, k), dp);
  if (near) {
    const c = (shape.lo + shape.hi) / 2;
    const at = c >= LAST ? `above ${f(LAST)}` : c <= 0 ? `below ${f(1)}` : f(c);
    return `Near ${at} ±${shape.h - 1}`;
  }
  const lo = clamp(shape.lo, 0, LAST), hi = clamp(shape.hi, 0, LAST);
  if (lo === 0 && hi === LAST) return "Anywhere";
  if (lo === 0) return `Below ${f(hi + 1)}`;
  if (hi === LAST) return `Above ${f(lo)}`;
  return `Between ${f(lo)} and ${f(hi + 1)}`;
}

/** The floor a round settled on, in words: "64,321 to 65,457", "above 67,080". */
export function bandName(bin, grid, dp) {
  if (!grid || !(Number(grid.p0) > 0)) return `floor ${bin}`;
  if (bin <= 0) return `below ${fmt(edge(grid, 1), dp)}`;
  if (bin >= LAST) return `above ${fmt(edge(grid, LAST), dp)}`;
  return `${fmt(edge(grid, bin), dp)} to ${fmt(edge(grid, bin + 1), dp)}`;
}

const big = (v) => (v === null || v === undefined ? 0n : BigInt(v));

/** One round's rows (oldest first) and facts into its summary. */
export function summarize(ladder, rows, round, series, coins, now) {
  const r = round ?? {};
  const feedId = series?.feedId ?? null;
  const feed = feedId ? coins.feed(feedId) : null;
  const dp = feed?.dp ?? 2;
  const grid = r.p0 ? { p0: r.p0, expo: r.expo, stepBps: r.stepBps } : null;
  const quoteMint = r.quoteMint ?? rows.find((x) => x.mint)?.mint ?? null;
  const decimals = r.decimals ?? rows.find((x) => x.decimals !== null && x.decimals !== undefined)?.decimals ?? null;
  // A round whose settle (or void) the ledger never saw is still known to be
  // finished once it is closed or anything in it was paid out: the program
  // pays nothing before then. Its floor is then unknown.
  const paidOut = r.closed || rows.some((x) => x.kind === "redeem" || x.kind === "claim" || x.kind === "sweep");
  const status = r.voided ? "void" : r.settled || paidOut ? "settled" : r.settlesAt && now >= r.settlesAt ? "settling" : r.p0 ? "open" : "seeding";
  const bin = r.settled ? r.settled.bin : null;

  // positions by account (a redeem names only the account), tranches by index
  const pos = new Map(), tranches = new Map();
  const posOf = (x) => {
    const k = x.position ?? `${x.lo}:${x.hi}:${x.h}`;
    let p = pos.get(k);
    if (!p) { p = { shape: x.h ? { lo: x.lo, hi: x.hi, h: x.h } : null, shares: 0n, cost: 0n, bought: false, closed: false, got: 0n }; pos.set(k, p); }
    if (!p.shape && x.h) p.shape = { lo: x.lo, hi: x.hi, h: x.h };
    return p;
  };
  let paid = 0n, got = 0n;
  const actions = [];
  for (const x of rows) {
    paid += big(x.amountIn); got += big(x.amountOut);
    let kind = x.kind, shape = x.h ? { lo: x.lo, hi: x.hi, h: x.h } : null;
    if (x.kind === "buy") {
      const p = posOf(x);
      kind = p.bought ? "add" : "call";
      p.bought = true; p.shares += big(x.shares); p.cost += big(x.amountIn);
    } else if (x.kind === "sell") {
      const p = posOf(x), sold = -big(x.shares);
      if (p.shares > 0n) p.cost -= (p.cost * sold) / p.shares;
      p.shares -= sold;
    } else if (x.kind === "redeem" || x.kind === "sweep") {
      const p = posOf(x);
      p.closed = true; p.got += big(x.amountOut);
      shape = p.shape;
      if (x.kind === "redeem") kind = status === "void" ? "refund" : "collect";
    } else if (x.kind === "start" || x.kind === "deposit") {
      const t = tranches.get(x.tranche ?? 0) ?? { deposit: 0n, claimed: false };
      t.deposit += big(x.amountIn); tranches.set(x.tranche ?? 0, t);
    } else if (x.kind === "claim") {
      const t = tranches.get(x.tranche ?? 0) ?? { deposit: 0n, claimed: false };
      t.claimed = true; tranches.set(x.tranche ?? 0, t);
    }
    actions.push({
      sig: x.sig, time: x.time, kind,
      shape, name: shape ? callName(shape, grid, dp) : null,
      shares: x.shares, amountIn: x.amountIn, amountOut: x.amountOut, fee: x.fee, by: x.by ?? null,
    });
  }

  // what is still owed
  const final = status === "settled" || status === "void";
  let owed = 0n, owedUnknown = false;
  if (final) {
    for (const p of pos.values()) {
      if (p.closed) continue;
      if (status === "settled" && bin !== null && p.shape && p.shares > 0n) owed += p.shares * BigInt(level(p.shape, bin));
      if (status === "settled" && bin === null && !r.closed && p.shares > 0n) owedUnknown = true;   // floor unknown: it may pay
      if (status === "void" && (p.shares > 0n || p.cost > 0n)) owedUnknown = true;   // its share of the trader pot
    }
    if (!r.closed) for (const t of tranches.values()) if (!t.claimed && t.deposit > 0n) owedUnknown = true;   // a closed round owes nothing
  }
  const calledWon = [...pos.values()].some((p) => p.closed && p.got > 0n && (bin === null || (p.shape && level(p.shape, bin) > 0)));
  const net = got - paid;
  const result = !final ? "open"
    : owed > 0n || owedUnknown ? "unclaimed"
    : status === "void" ? "refunded"
    : calledWon || (pos.size === 0 && net > 0n) ? "won" : "missed";

  // the round's own notes, in time order with the wallet's actions
  if (r.settled) actions.push({ sig: r.settled.sig, time: r.settled.time, kind: "settle", name: bandName(r.settled.bin, grid, dp), shape: null, shares: null, amountIn: "0", amountOut: "0", fee: "0", by: null });
  if (r.voided) actions.push({ sig: r.voided.sig, time: r.voided.time, kind: "void", name: null, shape: null, shares: null, amountIn: "0", amountOut: "0", fee: "0", by: null });
  actions.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  const calls = [...new Set([...pos.values()].filter((p) => p.shape && p.bought).map((p) => callName(p.shape, grid, dp)))];
  return {
    ladder,
    coin: coins.coin(quoteMint, feedId),
    quoteMint, decimals,
    feed: feed ? { id: feedId, symbol: feed.symbol, name: feed.name, dp } : feedId ? { id: feedId, symbol: null, name: null, dp } : null,
    index: r.index ?? null,
    settlesAt: r.settlesAt ?? null,
    status,
    settled: r.settled ? { price: r.settled.price != null ? fmt(Number(r.settled.price) * 10 ** r.settled.expo, dp) : null, bin: r.settled.bin, band: bandName(r.settled.bin, grid, dp) } : null,
    result,
    paid: String(paid), got: String(got), net: String(net),
    owed: owed > 0n ? String(owed) : null,
    claimable: result === "unclaimed",
    calls,
    house: tranches.size > 0,
    actions,
  };
}

/** Rounds newest close first; a round not yet known by its close sorts by its first action. */
const sortKey = (s, firstTime) => s.settlesAt ?? firstTime ?? 0;
export const cursorOf = (s) => `${s._key}_${s.ladder}`;

/**
 * The page the app asks for. `coin` (a symbol or a quote mint) narrows the
 * rounds and the totals; `result` narrows only the rounds, so the totals stay
 * the wallet's record in that coin.
 */
export function buildHistory({ wallet, rows, round, series, coins, now = Math.floor(Date.now() / 1000), limit = 20, before = null, coin = null, result = null }) {
  const byLadder = new Map();
  for (const x of rows) { const l = byLadder.get(x.ladder) ?? []; l.push(x); byLadder.set(x.ladder, l); }
  let all = [...byLadder.entries()].map(([ladder, rs]) => {
    const r = round(ladder);
    const s = summarize(ladder, rs, r, r?.series ? series(r.series) : null, coins, now);
    s._key = sortKey(s, rs[0]?.time);
    return s;
  });
  if (coin) all = all.filter((s) => s.coin === coin || s.quoteMint === coin);
  all.sort((a, b) => b._key - a._key || (a.ladder < b.ladder ? 1 : -1));

  const totals = { rounds: all.length, results: Object.fromEntries(RESULTS.map((k) => [k, 0])), coins: [] };
  const perCoin = new Map();
  for (const s of all) {
    totals.results[s.result]++;
    const k = s.quoteMint ?? "?";
    const c = perCoin.get(k) ?? { mint: s.quoteMint, coin: s.coin, decimals: s.decimals, rounds: 0, paid: 0n, got: 0n, owed: 0n, atWork: 0n };
    c.rounds++; c.owed += BigInt(s.owed ?? 0);
    // paid, got and net count finished rounds only: a running round has not
    // paid anything yet, and would read as a loss. What it holds is at work.
    if (s.result === "open") c.atWork += BigInt(s.paid) - BigInt(s.got);
    else { c.paid += BigInt(s.paid); c.got += BigInt(s.got); }
    if (c.decimals === null) c.decimals = s.decimals;
    perCoin.set(k, c);
  }
  totals.coins = [...perCoin.values()].sort((a, b) => b.rounds - a.rounds).map((c) => ({ ...c, paid: String(c.paid), got: String(c.got), net: String(c.got - c.paid), owed: String(c.owed), atWork: String(c.atWork) }));

  let list = result ? all.filter((s) => s.result === result) : all;
  if (before) {
    const at = list.findIndex((s) => cursorOf(s) === before);
    if (at >= 0) list = list.slice(at + 1);
    else {
      const [k, l] = before.split("_");
      list = list.filter((s) => s._key < Number(k) || (s._key === Number(k) && s.ladder < l));
    }
  }
  const page = list.slice(0, limit);
  const next = list.length > limit ? cursorOf(page[page.length - 1]) : null;
  return { wallet, totals, matching: result ? all.filter((s) => s.result === result).length : all.length, rounds: page.map(({ _key, ...s }) => s), next };
}

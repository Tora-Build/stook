// What one wallet does when its turn comes, built exactly as the app builds
// it: the same instructions, limits, compute units and checks as
// Ticket.tsx (buy, sell), LpPanel.tsx (house deposit), StartRound.tsx (fund a
// round), lib/collect.ts (collect, refund) and Faucet.tsx (test coins).
//
// `decide` picks the action from the persona and the world; `build` reads
// what it must fresh (the round, the wallet's line) and returns transactions
// or throws a Skip. Nothing here sends.

import { TOKEN_PROGRAM_ID, createMintToInstruction } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { ataOf, ensureAta, readAccounts } from "./chain.mjs";
import { depositUsd, seedUsd, spendUsd, unit } from "./personas.mjs";
import { expectedLevel, pickLine, sharesFor, sigmaFor } from "./pricing.mjs";
import { utcDay } from "./budget.mjs";
import { nyClock } from "./schedule.mjs";

/** Not an error: there is nothing sensible for this wallet to do right now. */
export class Skip extends Error {
  constructor(reason, name = "Skipped") { super(reason); this.name = "Skip"; this.skipName = name; }
}

// ── amounts, as the app computes them ───────────────────────────────────────

/** Whole coins worth about `worth` dollars, two significant figures; 10,000 while the price is unknown (Faucet.tsx `coinsForWorth`). */
export function coinsForWorth(usd, worth = 1_000) {
  if (!usd || !(usd > 0)) return 10_000;
  const raw = worth / usd, scale = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.max(1, Math.round(raw / scale) * scale);
}

/** Base units of the coin worth `usd` dollars, rounded down (lib/usd.tsx `fromUsd`). */
export const fromUsd = (usd, decimals, rate) => (rate > 0 && usd > 0 ? BigInt(Math.floor((usd / rate) * 10 ** decimals)) : 0n);

const whole = (dec) => 10n ** BigInt(dec);
const min = (a, b) => (a < b ? a : b);
const refsOf = (key, l, c) => ({ ladder: key, quoteMint: l.quoteMint, tokenProgram: c.tokenProgram });

/** Open for trading at `t` (seconds), with a minute to spare before the lock. */
export const tradeable = (l, t) => !!l && l.status === "open" && BigInt(t) >= l.opensAt && BigInt(t) < l.locksAt - 60n;
/** Takes deposits at `t` (LpPanel.tsx), with two minutes to spare. */
export const joinable = (l, t) => !!l && (l.status === "seeding" || l.status === "open") && BigInt(t) < l.locksAt - 120n;
export const finished = (l) => !!l && (l.status === "settled" || l.status === "void");

// ── the journal: what each wallet holds, so nothing needs a scan ────────────

export function walletJournal(journal, index) {
  const k = String(index);
  journal.wallets ??= {};
  journal.wallets[k] ??= { positions: [], tranches: [], faucetDay: null };
  return journal.wallets[k];
}

/** Lines the fleet holds in each round, by round address. */
export function fleetLines(journal) {
  const by = new Map();
  for (const w of Object.values(journal.wallets ?? {})) for (const p of w.positions) by.set(p.ladder, (by.get(p.ladder) ?? 0) + 1);
  return by;
}

/**
 * Rounds this wallet holds something in that it is time to collect: past
 * their close (or void) and its own delay. A round found not yet settled
 * (the keeper is late) waits in `j.later` until its next look.
 */
export function dueRounds(j, profile, t, world) {
  const status = new Map();
  for (const c of world?.coins ?? []) for (const d of [c.today, c.tomorrow]) if (d?.round) status.set(d.key.toBase58(), d.round.l.status);
  const rounds = new Map();
  for (const e of [...j.positions, ...j.tranches]) {
    const s = status.get(e.ladder);
    if ((j.later?.[e.ladder] ?? 0) > t) continue;
    const due = s === "void" || (s !== "open" && s !== "seeding" && t >= Number(e.settlesAt) + profile.collectDelay);
    if (due) rounds.set(e.ladder, e.coin);
  }
  return [...rounds.entries()].map(([ladder, coin]) => ({ ladder, coin }));
}

// ── deciding ────────────────────────────────────────────────────────────────

/**
 * The action for one wallet's turn. `ctx` holds the world, the wallet's
 * profile, balances and journal, the fleet's journal, a generator and the
 * clock. Returns `{ type, coin?, round?, params, build }`.
 */
export function decide(ctx) {
  const { world, profile, bal, j, rng, t, cfg } = ctx;
  const coins = world.coins.filter((c) => c.series);
  const today = utcDay(t * 1000);

  // Test coins first when the wallet has run low, once a day.
  if (ctx.faucet && j.faucetDay !== today) {
    const low = coins.filter((c) => (bal.coins[c.symbol] ?? 0n) < faucetAmount(c, ctx.rates, cfg) / 5n);
    if (low.length) return faucetAction(ctx, coins);
  }

  // Finished rounds to collect: redeem every line (misses too, so the keeper
  // has nothing to sweep) and claim every deposit.
  const due = dueRounds(j, profile, t, world);
  if (due.length && rng() < 0.9) return collectAction(ctx, due);

  const order = [...coins].sort((a, b) => (a === coins[profile.favourite % coins.length] ? -1 : b === coins[profile.favourite % coins.length] ? 1 : rng() - 0.5));
  const open = order.filter((c) => tradeable(c.today?.round?.l, t));

  switch (profile.persona) {
    case "starter": {
      const s = startChoice(ctx, coins);
      if (s) return startAction(ctx, s.coin, s.day);
      const h = houseChoice(ctx, order);
      if (h) return joinAction(ctx, h.coin, h.day);
      break;
    }
    case "house": {
      // With no starter in the fleet, the houses are its funders (sim.mjs).
      if (ctx.starters?.includes(profile.index)) {
        const s = startChoice(ctx, coins);
        if (s) return startAction(ctx, s.coin, s.day);
      }
      const h = houseChoice(ctx, order);
      if (h) return joinAction(ctx, h.coin, h.day);
      return { type: "idle", params: { why: "no round takes deposits now" }, build: async () => { throw new Skip("no round takes deposits now"); } };
    }
    case "trader": {
      const held = j.positions.filter((p) => open.some((c) => c.today.key.toBase58() === p.ladder) && t >= p.boughtAt + profile.holdSecs);
      if (held.length) {
        const p = held[Math.floor(rng() * held.length)];
        const pct = rng() < 0.5 ? 100 : rng() < 0.5 ? 50 : 25;
        return sellAction(ctx, open.find((c) => c.today.key.toBase58() === p.ladder), p, pct);
      }
      break;
    }
    default:
  }
  if (!open.length) return { type: "idle", params: { why: "no round is trading" }, build: async () => { throw new Skip("no round is trading"); } };
  const coin = open[0];
  // Now and then add to a line already held there.
  const mine = j.positions.filter((p) => p.ladder === coin.today.key.toBase58());
  if (mine.length && rng() < 0.15) return buyAction(ctx, coin, profile.persona === "longshot" ? "far" : "near", mine[Math.floor(rng() * mine.length)]);
  return buyAction(ctx, coin, profile.persona === "longshot" ? "far" : "near");
}

/**
 * A retiring wallet's turn: only its finished rounds, collected as soon as
 * they are due; null when nothing is. It never buys, sells, deposits,
 * funds or asks the faucet. `ctx.payer` (the treasury) pays the fees.
 */
export function decideRetiring(ctx) {
  const due = dueRounds(ctx.j, { ...ctx.profile, collectDelay: 0 }, ctx.t, ctx.world);
  return due.length ? collectAction(ctx, due) : null;
}

/** Nothing left in the journal: every line and deposit collected or gone. */
export const holdsNothing = (j) => !j || (!(j.positions?.length) && !(j.tranches?.length));

/** A starter's round to fund: tomorrow's canonical one when a coin has none, or today's with 75 minutes or more to go (it opens at once and trades until its lock). */
function startChoice(ctx, coins) {
  const { t, profile, starters, cfg } = ctx;
  const ny = nyClock(t * 1000);
  for (const c of coins) {
    if (!c.series?.active || !stook.warmedUp(c.series)) continue;
    for (const day of [c.tomorrow, c.today]) {
      if (!day || day.round) continue;
      const settlesAt = Number(stook.closeOf(c.series, day.index));
      // The app's margin (MIN_LEAD_SECS, 15 minutes and 90 s); today's only with 75 minutes left, so it still trades for an hour.
      if (settlesAt - t < (day === c.today ? 75 * 60 : 15 * 60 + 90) || settlesAt - t > 31 * 86_400) continue;
      // One starter per coin per day; after noon New York any starter may step in.
      const chosen = starters[Math.floor(unit(cfg.seed, "starter", c.symbol, day.index) * starters.length)];
      if (chosen === profile.index || ny.minute >= 12 * 60) return { coin: c, day };
    }
  }
  return null;
}

function houseChoice(ctx, order) {
  const { t, j } = ctx;
  for (const c of order) {
    // Before trading opens no trade moves the curve, so a deposit cannot miss its sequence.
    for (const day of [c.tomorrow, c.today]) {
      const l = day?.round?.l;
      if (!joinable(l, t)) continue;
      const mine = j.tranches.filter((x) => x.ladder === day.key.toBase58()).length;
      if (mine < 2) return { coin: c, day };
    }
  }
  return null;
}

// ── the actions ─────────────────────────────────────────────────────────────

export function faucetAmount(c, rates, cfg) {
  return BigInt(coinsForWorth(rates?.[c.symbol], cfg.faucetUsd)) * whole(c.decimals);
}

/** Test USDC the app's faucet mints alongside the coins: 1,000, on the classic token program. */
export const FAUCET_USDC = 1_000n * 1_000_000n;

function faucetAction(ctx, coins) {
  const { wallet, faucet, rates, cfg } = ctx;
  const amounts = Object.fromEntries(coins.map((c) => [c.symbol, faucetAmount(c, rates, cfg)]));
  const usdc = cfg.quoteMint ? new PublicKey(cfg.quoteMint) : null;
  return {
    type: "faucet",
    params: { coins: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toString()])), usdc: !!usdc },
    build: async () => {
      const owner = wallet.publicKey, ixs = [];
      // The app's one transaction: the test USDC first, then each coin's twin.
      if (usdc) ixs.push(ensureAta(usdc, owner, TOKEN_PROGRAM_ID), createMintToInstruction(usdc, ataOf(usdc, owner, TOKEN_PROGRAM_ID), faucet.publicKey, FAUCET_USDC, [], TOKEN_PROGRAM_ID));
      for (const c of coins) ixs.push(ensureAta(c.mintKey, owner, c.tokenProgram), createMintToInstruction(c.mintKey, ataOf(c.mintKey, owner, c.tokenProgram), faucet.publicKey, amounts[c.symbol], [], c.tokenProgram));
      return [{ ixs, cu: 200_000, signers: [wallet, faucet] }];
    },
    done: () => { ctx.j.faucetDay = utcDay(ctx.t * 1000); },
  };
}

/** A budget in base units: dollars by tier at the coin's rate, else coins; held to the wallet and, unless `probe`, to the round's depth. */
function budgetFor(ctx, c, l, usd, probe = false) {
  const rate = ctx.rates?.[c.symbol];
  let b = rate ? fromUsd(usd, c.decimals, rate) : BigInt(Math.round(usd * 20)) * whole(c.decimals);
  const bal = ctx.bal.coins[c.symbol] ?? 0n;
  b = min(b, (bal * 98n) / 100n);
  const depth = (l.depositTotal * BigInt(Math.round(ctx.cfg.maxDepthFrac * 10_000))) / 10_000n;
  return { budget: probe ? b : min(b, depth), balance: bal, depthCap: depth };
}

// Belief-weighted value per unit spent below which a persona does not buy.
const EDGE = { caller: 1, collector: 1, trader: 1.1, starter: 1, house: 1, longshot: 0.5 };

/** Lines the fleet holds across every round of the world closing at `settlesAt`. */
export function linesClosingAt(ctx, settlesAt) {
  let n = 0;
  for (const x of ctx.world.coins) {
    const d = x.today;
    if (d?.round && d.round.l.settlesAt === settlesAt) n += ctx.lines.get(d.key.toBase58()) ?? 0;
  }
  return n;
}

function buyAction(ctx, c, kind, add = null) {
  const { profile, rng, t, cfg, lines } = ctx;
  // Now and then a buy sized to the most the round can price (the app's
  // "Round limit"), past the depth cap and whatever the edge.
  const probe = !add && rng() < (cfg.probeShare ?? 0);
  const usd = probe ? 2 * spendUsd("whale", rng) : spendUsd(profile.tier, rng);
  return {
    type: "buy",
    coin: c.symbol,
    round: c.today.key.toBase58(),
    params: { kind, usd: +usd.toFixed(2), add: !!add, ...(probe ? { probe } : {}) },
    build: async (reader) => {
      const key = c.today.key;
      const l = (await reader.ladder(key)) ?? c.today.round.l;
      if (!tradeable(l, t)) throw new Skip("round not trading", "LadderNotOpen");
      if (!add && (lines.get(key.toBase58()) ?? 0) >= cfg.maxPositionsPerRound) throw new Skip("fleet holds enough lines in this round");
      if (!add && linesClosingAt(ctx, l.settlesAt) >= cfg.maxLinesPerClose) throw new Skip("fleet holds enough lines closing at this time");
      const live = await reader.livePrice(c);
      if (!live) throw new Skip("no live price");
      const sigma = sigmaFor(stook.seriesVariance(c.series), Number(l.settlesAt) - t);
      const pick = pickLine(kind, { live, l, sigma, rng });
      const shape = add ? { lo: add.lo, hi: add.hi, h: add.h } : pick.shape;
      const { budget, balance } = budgetFor(ctx, c, l, usd, probe);
      if (budget <= 0n) throw new Skip("no coins or no depth", "InsufficientFunds");
      // Quoted at the rate it lands at: the fee rises over the last six hours.
      const feeBps = stook.feeBpsAt(l.feeBps, BigInt(t + 10), l.settlesAt);
      const shares = sharesFor(l, shape, budget, feeBps, c.transferFee);
      if (shares <= 0n) throw new Skip("the round can price no more of this line");
      const q = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, shape, shares);
      const pays = stook.grossFor(q.total, c.transferFee);
      const value = Number(stook.netOf(BigInt(Math.floor(expectedLevel(shape, pick.odds) * Number(shares))), c.transferFee));
      const edge = value / Number(pays);
      if (!probe && edge < (EDGE[profile.persona] ?? 1)) throw new Skip(`no edge (${edge.toFixed(2)})`);
      const limit = stook.maxGrossFor(q.total, [c.transferFee]);
      if (balance < limit) throw new Skip("balance under the limit", "InsufficientFunds");
      const owner = ctx.wallet.publicKey;
      checked(ctx, key, l, "InsufficientFunds");
      Object.assign(ctx.detail, { shape, shares: shares.toString(), pays: pays.toString(), limit: limit.toString(), feeBps, edge: +edge.toFixed(3), price: live.source, curveSeq: l.curveSeq.toString(), balance: balance.toString() });
      return [{
        ixs: [ensureAta(l.quoteMint, owner, c.tokenProgram), stook.tradeLadderIx(refsOf(key, l, c), { user: owner, userToken: ataOf(l.quoteMint, owner, c.tokenProgram), shape, shares, limit })],
        cu: stook.tradeComputeUnits(shape), signers: [ctx.wallet],
      }];
    },
    done: () => {
      const s = ctx.detail.shape, key = c.today.key.toBase58();
      if (!ctx.j.positions.some((p) => p.ladder === key && p.lo === s.lo && p.hi === s.hi && p.h === s.h)) {
        ctx.j.positions.push({ ladder: key, coin: c.symbol, lo: s.lo, hi: s.hi, h: s.h, settlesAt: Number(c.today.round.l.settlesAt), boughtAt: t });
      }
    },
  };
}

function sellAction(ctx, c, p, pct) {
  const { t } = ctx;
  return {
    type: "sell",
    coin: c.symbol,
    round: p.ladder,
    params: { pct, shape: { lo: p.lo, hi: p.hi, h: p.h } },
    build: async (reader) => {
      const key = new PublicKey(p.ladder), owner = ctx.wallet.publicKey, shape = { lo: p.lo, hi: p.hi, h: p.h };
      const [la, pa] = await readAccounts(reader.conn, [key, stook.deriveLadderPosition(key, owner, shape)]);
      if (!pa) { ctx.dropPosition = shape; throw new Skip("line no longer held", "NothingToCollect"); }
      const l = stook.decodeLadder(la.data), pos = stook.decodeLadderPosition(pa.data);
      if (!tradeable(l, t)) throw new Skip("round not trading", "LadderNotOpen");
      const size = (pos.shares * BigInt(pct)) / 100n;
      if (size <= 0n) throw new Skip("nothing to sell");
      let q;
      try { q = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: stook.feeBpsAt(l.feeBps, BigInt(t + 10), l.settlesAt), decimals: l.decimals }, shape, -size); } catch { throw new Skip("the sale pays nothing"); }
      const limit = stook.minNetOf(q.total, [c.transferFee]);
      checked(ctx, key, l, "LadderInsufficientShares");
      Object.assign(ctx.detail, { curveSeq: l.curveSeq.toString(), size: size.toString(), gets: stook.netOf(q.total, c.transferFee).toString(), limit: limit.toString(), paid: ((pos.netPaid * size) / pos.shares).toString() });
      ctx.soldAll = size === pos.shares;
      return [{
        ixs: [ensureAta(l.quoteMint, owner, c.tokenProgram), stook.tradeLadderIx(refsOf(key, l, c), { user: owner, userToken: ataOf(l.quoteMint, owner, c.tokenProgram), shape, shares: -size, limit })],
        cu: stook.tradeComputeUnits(shape), signers: [ctx.wallet],
      }];
    },
    // A line sold whole is still an account until redeemed (it pays 0 and
    // gives the rent back), so the journal keeps it for collection, and
    // does not offer it for sale again. Part of one waits another hold.
    done: () => { p.boughtAt = ctx.soldAll ? t + 10 * 86_400 : t; },
  };
}

function nextTrancheIndex(j, ladder) {
  const mine = j.tranches.filter((x) => x.ladder === ladder).map((x) => x.index);
  return mine.length ? Math.max(...mine) + 1 : 0;
}

function joinAction(ctx, c, day) {
  const { profile, rng, t } = ctx;
  const usd = depositUsd(profile.tier, rng);
  const key = day.key;
  return {
    type: "join",
    coin: c.symbol,
    round: key.toBase58(),
    params: { usd: +usd.toFixed(2), status: day.round.l.status },
    build: async (reader) => {
      // The sequence must match the round's at landing: read it fresh.
      const l = await reader.ladder(key);
      if (!joinable(l, t)) throw new Skip("round no longer takes deposits", "LadderNotJoinable");
      const rate = ctx.rates?.[c.symbol];
      const bal = ctx.bal.coins[c.symbol] ?? 0n;
      let deposit = rate ? fromUsd(usd, c.decimals, rate) : BigInt(Math.round(usd * 20)) * whole(c.decimals);
      deposit = min(deposit, (bal * 90n) / 100n);
      if (deposit < whole(l.decimals)) throw new Skip("less than one whole coin to deposit", "InsufficientFunds");
      const index = nextTrancheIndex(ctx.j, key.toBase58());
      if (index > 255) throw new Skip("every deposit slot used");
      const maxGross = stook.maxGrossFor(deposit, [c.transferFee], 0n);
      if (bal < maxGross) throw new Skip("balance under the deposit", "InsufficientFunds");
      const owner = ctx.wallet.publicKey;
      checked(ctx, key, l, "InsufficientFunds");
      Object.assign(ctx.detail, { deposit: deposit.toString(), maxGross: maxGross.toString(), index, expectedSeq: l.curveSeq.toString() });
      ctx.joinIndex = index; ctx.joinSettles = Number(l.settlesAt);
      return [{
        ixs: [ensureAta(l.quoteMint, owner, c.tokenProgram), stook.joinLadderIx(refsOf(key, l, c), { lp: owner, lpToken: ataOf(l.quoteMint, owner, c.tokenProgram), index, deposit, expectedSeq: l.curveSeq, maxGross })],
        cu: 120_000, signers: [ctx.wallet],
      }];
    },
    done: () => { ctx.j.tranches.push({ ladder: key.toBase58(), coin: c.symbol, index: ctx.joinIndex, settlesAt: ctx.joinSettles }); },
  };
}

/** SOL a start locks up as rent: the round, its vault and the first deposit (StartRound.tsx says about 0.026), with room for the fee. */
export const START_LAMPORTS = 30_000_000n;

function startAction(ctx, c, day) {
  const { profile, rng, t } = ctx;
  const usd = seedUsd(profile.tier, rng);
  const key = day.key;
  return {
    type: "start",
    coin: c.symbol,
    round: key.toBase58(),
    lamports: START_LAMPORTS,
    params: { usd: +usd.toFixed(2), index: day.index },
    build: async () => {
      const rate = ctx.rates?.[c.symbol];
      const bal = ctx.bal.coins[c.symbol] ?? 0n;
      let seed = rate ? fromUsd(usd, c.decimals, rate) : BigInt(Math.round(usd * 20)) * whole(c.decimals);
      seed = min(seed, (bal * 90n) / 100n);
      if (seed < whole(c.decimals)) throw new Skip("less than one whole coin to seed", "InsufficientFunds");
      const maxGross = stook.maxGrossFor(seed, [c.transferFee], 0n);
      if (bal < maxGross) throw new Skip("balance under the seed", "InsufficientFunds");
      const owner = ctx.wallet.publicKey;
      const terms = stook.roundTerms(c.series, day.index, BigInt(t));
      if (!terms.fundable) throw new Skip("day not fundable now", "LadderBadTimes");
      checked(ctx, null, null, "InsufficientFunds");
      Object.assign(ctx.detail, { seed: seed.toString(), maxGross: maxGross.toString(), settlesAt: Number(terms.settlesAt), opensAt: Number(terms.opensAt) });
      ctx.startSettles = Number(terms.settlesAt);
      return [{
        ixs: [ensureAta(c.mintKey, owner, c.tokenProgram), stook.createLadderIx({
          series: c.seriesKey, index: day.index, quoteMint: c.mintKey, creator: owner, creatorToken: ataOf(c.mintKey, owner, c.tokenProgram),
          tokenProgram: c.tokenProgram, seed, maxGross, issuerTrusted: c.report?.verdict === "issuer-trusted",
        })],
        cu: 200_000, signers: [ctx.wallet],
      }];
    },
    done: () => { ctx.j.tranches.push({ ladder: key.toBase58(), coin: c.symbol, index: 0, settlesAt: ctx.startSettles, created: true }); },
  };
}

/**
 * Collect finished rounds: every journaled line redeemed and every deposit
 * claimed, packed as lib/collect.ts packs them. Entries whose accounts are
 * gone (collected, or swept by the keeper) leave the journal.
 */
function collectAction(ctx, due) {
  const owner = ctx.wallet.publicKey;
  return {
    type: "collect",
    coin: due[0].coin,
    round: due[0].ladder,
    params: { rounds: due.length },
    build: async (reader) => {
      const txs = [];
      const gone = [];
      ctx.collected = [];
      // Up to three finished rounds a turn, looking at six at most; one not
      // settled yet is looked at again in half an hour.
      let looked = 0;
      for (const { ladder, coin } of due) {
        if (ctx.collected.length >= 3 || looked >= 6) break;
        looked++;
        const key = new PublicKey(ladder);
        const c = ctx.world.coins.find((x) => x.symbol === coin);
        const pos = ctx.j.positions.filter((p) => p.ladder === ladder);
        const trs = ctx.j.tranches.filter((x) => x.ladder === ladder);
        const keys = [key, ...pos.map((p) => stook.deriveLadderPosition(key, owner, p)), ...trs.map((x) => stook.deriveLadderTranche(key, owner, x.index))];
        const infos = await readAccounts(reader.conn, keys);
        const la = infos[0];
        const posA = infos.slice(1, 1 + pos.length), trA = infos.slice(1 + pos.length);
        if (!la) { gone.push(ladder); continue; }
        const l = stook.decodeLadder(la.data);
        if (!finished(l)) { (ctx.j.later ??= {})[ladder] = ctx.t + 1800; continue; }
        const refs = refsOf(key, l, c);
        const ata = ataOf(l.quoteMint, owner, c.tokenProgram);
        const items = [
          ...pos.filter((_p, n) => posA[n]).map((p) => ({ ix: stook.redeemLadderIx(refs, owner, ata, { lo: p.lo, hi: p.hi, h: p.h }), units: stook.REDEEM_COMPUTE_UNITS })),
          ...trs.map((x, n) => (trA[n] ? { ix: stook.claimLpIx(refs, owner, ata, x.index), units: stook.claimComputeUnits(l, stook.decodeLadderTranche(trA[n].data)) } : null)).filter(Boolean),
        ];
        if (!items.length) { gone.push(ladder); continue; }
        // With a payer (a retiring wallet's collect), it pays the fee and any account the wallet lacks.
        const payer = ctx.payer ?? null;
        stook.packByCompute(items).forEach((chunk, n) => txs.push({ ixs: [...(n === 0 ? [ensureAta(l.quoteMint, owner, c.tokenProgram, payer?.publicKey)] : []), ...chunk.ixs], cu: chunk.units, signers: payer ? [payer, ctx.wallet] : [ctx.wallet], ladder }));
        ctx.collected.push({ ladder, status: l.status, lines: items.length });
      }
      ctx.gone = gone;
      Object.assign(ctx.detail, { collected: ctx.collected, gone: gone.length });
      // Rounds swept or closed before we came: the journal forgets them.
      for (const ladder of gone) forget(ctx.j, ladder);
      if (!txs.length) throw new Skip("nothing to collect", "NothingToCollect");
      checked(ctx, null, null, "LadderNotFinal", "InsufficientFunds");
      return txs;
    },
    done: (landed) => { for (const ladder of new Set(landed.map((x) => x.ladder))) forget(ctx.j, ladder); },
  };
}

export function forget(j, ladder) {
  j.positions = j.positions.filter((p) => p.ladder !== ladder);
  j.tranches = j.tranches.filter((x) => x.ladder !== ladder);
  if (j.later) delete j.later[ladder];
}

/** Forget one line only, the rest of the wallet's round kept. */
export function forgetLine(j, ladder, shape) {
  j.positions = j.positions.filter((p) => !(p.ladder === ladder && p.lo === shape.lo && p.hi === shape.hi && p.h === shape.h));
}

/**
 * What the build checked before sending: the round it quoted (`key` and the
 * curve's sequence), and the refusals its own checks ruled out. `sim.mjs`
 * reads these back when a send fails, to tell a moved market from a bug.
 */
function checked(ctx, key, l, ...ruledOut) {
  ctx.asserted ??= new Set();
  for (const n of ruledOut) ctx.asserted.add(n);
  if (key && l) ctx.quoted = { key, seq: l.curveSeq };
}

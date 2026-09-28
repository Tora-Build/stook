// The fleet: who acts when, the treasury's top-ups, the logs, the alerts and
// the daily report. Chain access comes in through `deps` (a reader, a
// sender, wallet reads), so the tests drive it against mocks.

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { SystemProgram } from "@solana/web3.js";
import { LAMPORTS } from "./config.mjs";
import { decide, fleetLines, forgetLine, Skip, walletJournal } from "./actions.mjs";
import { classify, kindOf, renamed } from "./classify.mjs";
import { planTopUps, SolBudget } from "./budget.mjs";
import { nextArrival, nyClock, pauseReason } from "./schedule.mjs";
import { profileOf } from "./personas.mjs";

const REPORT_MINUTE = 21 * 60; // 21:00 New York
// Sends signed again after expiring unseen: those a second copy cannot
// repeat (a second start or deposit slot is refused, a second collect finds
// nothing). A buy, a sale or a top-up would run twice, so they fail instead.
const RESIGN = new Set(["start", "join", "collect", "faucet"]);
// Sends journaled when the connection dropped after they went out.
const JOURNAL_MAYBE = new Set(["buy", "join", "start"]);

/**
 * deps: { cfg, weights, wallets, treasury, faucet, reader, sender, readWallets,
 *         getBalance, log, issues, alert, state, journal, persist, rng, now, sleep, plan, out }
 */
export function createSim(deps) {
  const { cfg, weights, wallets, reader, sender, rng, plan } = deps;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const out = deps.out ?? ((s) => console.log(s));
  const persist = plan ? () => {} : (deps.persist ?? (() => {}));
  const state = deps.state ?? {};
  const journal = deps.journal ?? { wallets: {} };
  const profiles = wallets.map((w) => profileOf(w.index, weights, cfg.seed));
  const starters = profiles.filter((p) => p.persona === "starter").map((p) => p.index);
  // With no starter in the mix, houses fund rounds.
  const funders = starters.length ? starters : profiles.filter((p) => p.persona === "house").map((p) => p.index);
  state.sol ??= {};
  const budget = new SolBudget(cfg.dailySol * LAMPORTS, state.sol, () => persist("state"));
  const lamports = new Map();
  let world = null, worldAt = 0;
  let stats = (state.stats ??= fresh());
  const planned = [];
  let stopping = false;
  // Every send asks right before it goes: a turn that waited on the minute
  // cap into a pause, or a shutdown, sends nothing.
  if (sender && !plan) sender.gate = (t) => (stopping ? "shutting down" : paused(t));

  function fresh() { return { since: new Date(now()).toISOString(), actions: {}, txs: 0, solLamports: "0" }; }
  function count(type, outcome) {
    const a = (stats.actions[type] ??= { ok: 0, expected: 0, transient: 0, unexpected: 0, skip: 0 });
    a[outcome]++;
  }

  function alert(args) {
    if (plan || !deps.alert) return;
    deps.alert(args);
  }

  async function refreshWorld(force = false) {
    if (!force && world && now() - worldAt < 60_000) return world;
    world = await reader.world();
    worldAt = now();
    return world;
  }
  const ourRounds = () => (world?.coins ?? []).flatMap((c) => [c.today?.round?.l, c.tomorrow?.round?.l]).filter(Boolean);

  /** Why the fleet should not act now, or null: the bell, a round of ours opening or settling, or a keeper that has gone quiet. */
  function paused(t = now()) {
    const why = pauseReason(t, ourRounds());
    if (why) return why;
    if (cfg.keeperBeat) {
      let age;
      try { age = (t - statSync(cfg.keeperBeat).mtimeMs) / 1000; } catch { return plan ? null : "keeper heartbeat file missing"; }
      if (age > cfg.beatMaxSecs) return `keeper heartbeat ${Math.round(age)} s old`;
    }
    return null;
  }

  function record(entry) {
    if (plan) { planned.push(entry); out(JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v))); return; }
    deps.log?.append(entry);
  }

  /** Top up these wallets from the treasury, 20 transfers a transaction, inside the day's allowance. */
  async function topUp(list, reason) {
    const done = [];
    for (let i = 0; i < list.length; i += 20) {
      const chunk = list.slice(i, i + 20);
      const total = chunk.reduce((a, x) => a + x.lamports, 0n);
      const fee = 10_000n;
      // Booked before it goes; given back only if it surely did not land.
      const receipt = budget.reserve(total + fee, now());
      if (!receipt) break;
      const ixs = chunk.map((x) => SystemProgram.transfer({ fromPubkey: deps.treasury.publicKey, toPubkey: wallets[x.index].keypair.publicKey, lamports: x.lamports }));
      const started = now();
      try {
        const sig = await sender.send(ixs, 5_000 + 1_000 * chunk.length, [deps.treasury], "fund", { resign: false });
        stats.solLamports = (BigInt(stats.solLamports) + total + fee).toString();
        stats.txs++;
        for (const x of chunk) lamports.set(x.index, (lamports.get(x.index) ?? 0n) + x.lamports);
        count("fund", "ok");
        record({ at: new Date(now()).toISOString(), wallet: "treasury", persona: "treasury", action: "fund", params: { reason, wallets: chunk.map((x) => x.index), lamports: total.toString() }, sig, ms: now() - started });
        done.push(...chunk);
      } catch (e) {
        if (e?.notSent) budget.release(receipt, receipt.lamports, now());
        else if (e?.landed) budget.release(receipt, total, now()); // the fee went, the transfers did not
        if (e?.name === "Paused") { count("fund", "skip"); record({ at: new Date(now()).toISOString(), wallet: "treasury", persona: "treasury", action: "fund", skip: e.message, ms: now() - started }); }
        else failed("treasury", "treasury", "fund", null, null, { wallets: chunk.length }, e, started);
        persist("state");
        break;
      }
      persist("state");
    }
    return done;
  }

  /** Every wallet under SIM_SOL_MIN back up to SIM_SOL_TARGET, poorest first, while today's allowance lasts. */
  async function fundingSweep() {
    const infos = await deps.readLamports(wallets.map((w) => w.keypair.publicKey));
    infos.forEach((l, n) => lamports.set(n, l));
    const plans = planTopUps(infos, { min: BigInt(Math.round(cfg.solMin * LAMPORTS)), target: BigInt(Math.round(cfg.solTarget * LAMPORTS)), remaining: budget.remaining(now()) });
    if (plan) {
      const total = plans.reduce((a, x) => a + x.lamports, 0n);
      out(JSON.stringify({ plan: "fund", wallets: plans.length, sol: Number(total) / LAMPORTS, allowanceLeftSol: Number(budget.remaining(now())) / LAMPORTS, under: infos.filter((l) => l < BigInt(Math.round(cfg.solMin * LAMPORTS))).length }));
      return plans;
    }
    if (plans.length) await topUp(plans, "sweep");
    await checkTreasury();
    return plans;
  }

  async function checkTreasury() {
    if (!deps.getBalance) return;
    try {
      const bal = await deps.getBalance(deps.treasury.publicKey);
      if (bal < BigInt(LAMPORTS)) alert(["sim-treasury", `Stook sim treasury is down to ${(Number(bal) / LAMPORTS).toFixed(2)} SOL. Fund ${deps.treasury.publicKey.toBase58()} on devnet.`]);
    } catch { /* next sweep */ }
  }

  function failed(index, persona, action, coin, round, params, e, started, detail = {}, c = classify(e, action)) {
    const entry = { at: new Date(now()).toISOString(), wallet: index, persona, action, coin, round, params: { ...params, ...detail }, error: c.name, kind: c.kind, message: c.message, logs: c.logs, ms: now() - started };
    if (e?.signature) entry.sig = e.signature;
    count(action, c.kind);
    record(entry);
    if (c.kind === "unexpected" && !plan && deps.issues) {
      const isNew = deps.issues.record(c, { wallet: index, persona, action, coin, round, message: c.message, logs: c.logs, sig: e?.signature ?? null });
      if (isNew) alert([`sim-${c.hash}`, `Stook sim: new failure class ${c.name} on ${action} (${coin ?? "-"}). ${c.message.slice(0, 200)}`]);
    }
    return c;
  }

  /** A wallet to act, weighted by how active it is, among those with SOL to act with. */
  function pickWallet() {
    const floor = BigInt(Math.round(Math.min(cfg.solMin, 0.008) * LAMPORTS));
    const ready = profiles.filter((p) => plan || !lamports.has(p.index) || lamports.get(p.index) >= floor);
    const pool = ready.length ? ready : profiles;
    const total = pool.reduce((a, p) => a + p.activity, 0);
    let x = rng() * total;
    for (const p of pool) { if (x < p.activity) return p; x -= p.activity; }
    return pool[pool.length - 1];
  }

  /**
   * A refusal the build's own checks had ruled out, as a bug's name, or
   * null: funds or shares short after the check passed, a round not final
   * after it read final, or a slippage (or a moved curve) on a curve whose
   * sequence has not moved since the quote. The fleet acts one turn at a
   * time, so only a real user could move it in between.
   */
  async function recheck(ctx, c) {
    if (ctx.asserted?.has(c.name)) return `${c.name}DespiteCheck`;
    if ((c.name === "SlippageExceeded" || c.name === "LadderCurveMoved") && ctx.quoted) {
      try {
        const l = await reader.ladder(ctx.quoted.key);
        if (l && l.curveSeq === ctx.quoted.seq) return "QuoteMismatch";
      } catch { /* unknown: leave it expected */ }
    }
    return null;
  }

  /** One turn: pick a wallet, decide, build, send. Returns the log entry. */
  async function act(profile = pickWallet()) {
    const started = now();
    const w = wallets[profile.index];
    await refreshWorld();
    const [bal] = await deps.readWallets([w.keypair.publicKey], world.coins);
    lamports.set(profile.index, bal.lamports);
    // A wallet out of SOL is topped up on the spot, inside the allowance.
    if (!plan && bal.lamports < BigInt(Math.round(cfg.solMin * LAMPORTS))) {
      const need = [{ index: profile.index, lamports: BigInt(Math.round(cfg.solTarget * LAMPORTS)) - bal.lamports }];
      const got = await topUp(need, "on demand");
      if (!got.length) { count("idle", "skip"); record({ at: new Date(now()).toISOString(), wallet: profile.index, persona: profile.persona, action: "idle", skip: "no SOL and no allowance left today", ms: now() - started }); return null; }
      bal.lamports += need[0].lamports;
    }
    const rates = await reader.usdRates();
    const j = walletJournal(journal, profile.index);
    const ctx = { cfg, world, profile, bal, j, rng, t: Math.floor(now() / 1000), rates, faucet: deps.faucet, wallet: w.keypair, starters: funders, lines: fleetLines(journal), detail: {} };
    const a = decide(ctx);
    // An action that pays rent beyond the floor (a start) is topped up for it first.
    if (!plan && a.lamports && bal.lamports < a.lamports + BigInt(Math.round(cfg.solMin * LAMPORTS))) {
      const need = [{ index: profile.index, lamports: a.lamports + BigInt(Math.round(cfg.solTarget * LAMPORTS)) - bal.lamports }];
      if (!(await topUp(need, "rent")).length) { count(a.type, "skip"); record({ at: new Date(now()).toISOString(), wallet: profile.index, persona: profile.persona, action: a.type, coin: a.coin ?? null, skip: "not enough SOL for the rent and no allowance left today", ms: now() - started }); return null; }
      bal.lamports += need[0].lamports;
    }
    const base = { at: new Date(now()).toISOString(), wallet: profile.index, persona: profile.persona, action: a.type, coin: a.coin ?? null, round: a.round ?? null };
    let txs;
    try {
      txs = await a.build({ ...reader, conn: deps.conn });
    } catch (e) {
      if (e instanceof Skip) {
        if (ctx.dropPosition) forgetLine(j, a.round, ctx.dropPosition);
        persist("journal");
        count(a.type, "skip");
        const entry = { ...base, params: { ...a.params, ...ctx.detail }, skip: e.message, ms: now() - started };
        record(entry);
        return entry;
      }
      failed(profile.index, profile.persona, a.type, a.coin, a.round, a.params, e, started, ctx.detail);
      return null;
    }
    if (plan) {
      const entry = { ...base, params: { ...a.params, ...ctx.detail }, txs: txs.map((x) => ({ instructions: x.ixs.length, cu: x.cu, signers: x.signers.length })), ms: now() - started };
      record(entry);
      return entry;
    }
    const landed = [];
    const sigs = [];
    for (const tx of txs) {
      try {
        const sig = await sender.send(tx.ixs, tx.cu, tx.signers, a.type, { resign: RESIGN.has(a.type) });
        landed.push(tx); sigs.push(sig); stats.txs++;
      } catch (e) {
        if (a.type === "collect") {
          // Forget only the rounds collected whole.
          const partial = new Set(txs.filter((x) => !landed.includes(x)).map((x) => x.ladder));
          a.done?.(landed.filter((x) => !partial.has(x.ladder)));
        } else if (e?.maybeSent && JOURNAL_MAYBE.has(a.type)) {
          // It may have landed: journal it anyway; collect drops what is not there.
          a.done?.(txs);
        }
        if (e?.name === "Paused") {
          count(a.type, "skip");
          const entry = { ...base, params: { ...a.params, ...ctx.detail, sigs }, skip: e.message, ms: now() - started };
          record(entry);
          persist("journal");
          return entry;
        }
        let c = classify(e, a.type);
        const bug = await recheck(ctx, c);
        if (bug) c = renamed(e, a.type, c, bug);
        failed(profile.index, profile.persona, a.type, a.coin, a.round, a.params, e, started, { ...ctx.detail, sigs }, c);
        // A deposit slot or round already taken: remember it, so the next try moves on.
        if (c.name === "AlreadyInUse" && a.type === "join" && ctx.joinIndex !== undefined) j.tranches.push({ ladder: a.round, coin: a.coin, index: ctx.joinIndex, settlesAt: ctx.joinSettles, taken: true });
        // A round someone else funded first: read it on the next turn.
        if (c.name === "AlreadyInUse" && a.type === "start") worldAt = 0;
        persist("journal");
        persist("state");
        return null;
      }
    }
    a.done?.(landed);
    // A round just funded is read on the next turn, so no funder tries it again.
    if (a.type === "start") worldAt = 0;
    count(a.type, "ok");
    const entry = { ...base, params: { ...a.params, ...ctx.detail }, sig: sigs.length === 1 ? sigs[0] : sigs, ms: now() - started };
    record(entry);
    persist("journal");
    persist("state");
    return entry;
  }

  /** The day's summary, to Telegram at 21:00 New York, once. */
  function reportDue(t = now()) {
    const ny = nyClock(t);
    return ny.minute >= REPORT_MINUTE && state.lastReport !== ny.date;
  }
  function report(t = now()) {
    const ny = nyClock(t);
    const lines = Object.entries(stats.actions).sort().map(([k, v]) => {
      const tried = v.ok + v.expected + v.transient + v.unexpected;
      return `  ${k}: ${v.ok} ok of ${tried}${tried ? ` (${Math.round((v.ok / tried) * 100)}%)` : ""}, ${v.skip} skipped${v.unexpected ? `, ${v.unexpected} unexpected` : ""}`;
    });
    const top = deps.issues?.top(3) ?? [];
    const msg = [
      `🤖 Stook sim, ${ny.date} (since ${stats.since.slice(0, 16).replace("T", " ")} UTC)`,
      `Wallets: ${wallets.length}; transactions: ${stats.txs}; SOL sent from the treasury: ${(Number(BigInt(stats.solLamports)) / LAMPORTS).toFixed(3)}`,
      "Actions:", ...(lines.length ? lines : ["  none"]),
      ...(top.length ? ["Top unexpected:", ...top.map((i) => `  ${i.name} on ${i.signature.split(":")[0]}: ${i.count}x, last ${i.lastSeen.slice(0, 16)}`)] : ["No unexpected failures on record."]),
    ].join("\n");
    state.lastReport = ny.date;
    state.stats = stats = fresh();
    persist("state");
    if (!plan && deps.alert) deps.alert(["--report", msg]);
    return msg;
  }

  /** `--plan`: the world as read, the funding the treasury would do, and the next `n` turns, all without a send. */
  async function planRun(n = 20) {
    await refreshWorld(true);
    out(JSON.stringify({ plan: "world", coins: world.coins.map((c) => ({ coin: c.symbol, series: c.series ? { active: c.series.active, observations: c.series.observations } : null, today: c.today && { index: c.today.index, round: c.today.key.toBase58(), status: c.today.round?.l.status ?? "unfunded" }, tomorrow: c.tomorrow && { index: c.tomorrow.index, status: c.tomorrow.round?.l.status ?? "unfunded" }, transferFeeBps: c.transferFee?.bps ?? 0 })) }));
    out(JSON.stringify({ plan: "pause", now: paused() }));
    const mix = {};
    for (const p of profiles) mix[p.persona] = (mix[p.persona] ?? 0) + 1;
    out(JSON.stringify({ plan: "fleet", wallets: wallets.length, ephemeral: wallets.filter((w) => w.ephemeral).length, personas: mix, treasury: deps.treasury?.publicKey.toBase58() ?? null }));
    await fundingSweep();
    const arrivals = [];
    let t = now();
    for (let k = 0; k < 10; k++) { t = nextArrival(t, rng, cfg); arrivals.push(new Date(t).toISOString()); }
    out(JSON.stringify({ plan: "next arrivals", at: arrivals }));
    for (let k = 0; k < n; k++) await act();
    return planned;
  }

  /** `--once N`: N turns now (outside a pause), then stop. */
  async function once(n = 1) {
    await refreshWorld(true);
    const why = paused();
    if (why) { out(`paused: ${why}`); return []; }
    const done = [];
    for (let k = 0; k < n; k++) {
      // Asked again between turns: a pause can begin during a run.
      const stop = k ? paused() : null;
      if (stop) { out(`paused: ${stop}`); break; }
      done.push(await act());
    }
    return done;
  }

  /** `--watch`: the service. */
  async function watch({ until = () => false } = {}) {
    let next = nextArrival(now(), rng, cfg);
    let nextFund = 0, lastPause = null;
    const beatAge = (() => { try { return Math.round((now() - statSync(cfg.keeperBeat).mtimeMs) / 1000); } catch { return null; } })();
    out(`sim: ${wallets.length} wallets, cap ${cfg.txPerMin} tx/min, keeper heartbeat ${beatAge === null ? "missing" : `${beatAge} s old`}`);
    while (!until() && !stopping) {
      try {
        await refreshWorld();
        const why = paused();
        if (why !== lastPause) { out(why ? `paused: ${why}` : "resumed"); lastPause = why; }
        if (!why && now() >= nextFund) { await fundingSweep(); nextFund = now() + 10 * 60_000; }
        if (reportDue()) report();
        if (now() >= next) {
          if (!why) await act();
          next = nextArrival(now(), rng, cfg);
        }
      } catch (e) {
        const c = classify(e, "loop");
        out(`loop: ${c.name}: ${c.message.slice(0, 160)}`);
        if (c.kind === "unexpected" && deps.issues?.record(c, { message: c.message })) alert([`sim-${c.hash}`, `Stook sim loop error ${c.name}: ${c.message.slice(0, 200)}`]);
        await sleep(30_000);
      }
      await sleep(Math.max(1_000, Math.min(next - now(), 30_000)));
    }
  }

  /** Stop sending: sends in flight finish, nothing new starts. */
  function stop() { stopping = true; }

  return { act, once, watch, stop, planRun, fundingSweep, report, reportDue, paused, profiles, journal, state, budget, refreshWorld, get world() { return world; } };
}

/** alert.sh, when the box has it. It rate-limits itself. */
export function shellAlert(path) {
  return (args) => { if (existsSync(path)) execFile(path, args, { timeout: 20_000 }, () => {}); };
}

export { kindOf };

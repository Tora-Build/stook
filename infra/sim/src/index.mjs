#!/usr/bin/env node
// Stook's simulated users on devnet.
//
//   node src/index.mjs --plan [N]   read the chain, print the funding and the next N turns; send nothing, write nothing
//   node src/index.mjs --once N     take N turns now (unless paused), then exit
//   node src/index.mjs --watch      the service: turns paced to New York hours
//
// `--plan` goes alone: with --once or --watch it is refused. Every send also
// goes through one guard (`createSender`) that refuses in plan mode.
//
// ENV (defaults in config.mjs)
//   SIM_DIR               ~/sim: wallets/, sim.env, state.json, journal.json, actions.jsonl, issues.jsonl
//   SIM_TREASURY          ~/.config/solana/sim-treasury.json, the only other key read
//   SIM_WALLETS           100, the active fleet; wallet files past it retire: they collect what they
//                         hold, send all their SOL back and are left alone (state.json `retired`)
//   SIM_RPC_URL           default the public devnet endpoint, never the keeper's RPC_URL; SIM_RPC_PER_SEC (2) caps requests to it
//   SIM_TX_PER_MIN        4, over every send the fleet makes
//   SIM_SOL_MIN / SIM_SOL_TARGET / SIM_SOL_RECLAIM   0.012 / 0.04 / 0.06: topped up under the min, back
//                         to the treasury over the reclaim
//   SIM_DAILY_SOL         2, the treasury's net outflow a UTC day (top-ups and fees less SOL returned)
//   SIM_PERSONAS          e.g. "caller:45,longshot:10,trader:20,house:10,starter:5,collector:10"
//   SIM_MAX_POSITIONS_PER_ROUND / SIM_MAX_LINES_PER_CLOSE   15 / 40, so the keeper's sweep stays short
//   SIM_PROBE_SHARE       0.05 of buys sized to the round's limit, past SIM_MAX_DEPTH_FRAC (0.03)
//   SIM_KEEPER_BEAT       keeper heartbeat file (HEARTBEAT_FILE, ~/ladder-crank.beat); empty turns the check off
//   sim.env               FAUCET_AUTHORITY (JSON bytes), DEVNET_MINTS (JSON {symbol: mint}), QUOTE_MINT;
//                         any SIM_* setting here wins over the environment
//
// --once and --watch hold SIM_DIR/lock while they run; a second one is refused.

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { COINS, configProblem, loadConfig } from "./config.mjs";
import { createReader, createSender, makeConnection, readAccounts, readWallets } from "./chain.mjs";
import { loadErrorNames } from "./classify.mjs";
import { parseWeights, profileOf, rngFrom } from "./personas.mjs";
import { RpcBucket, TxWindow } from "./rate.mjs";
import { createSim, shellAlert } from "./sim.mjs";
import { IssueBook, JsonlLog, readJson, takeLock, writeJson } from "./store.mjs";
import { faucetAuthority, loadFleet, readKeypair, writeWalletList } from "./wallets.mjs";

/** `--plan [N]`, `--once N` or `--watch`; exactly one. */
export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const after = (f) => { const i = argv.indexOf(f); const v = i >= 0 ? Number(argv[i + 1]) : NaN; return Number.isInteger(v) && v > 0 ? v : null; };
  const mode = { plan: has("--plan"), watch: has("--watch"), once: has("--once") ? after("--once") ?? 1 : null, n: after("--plan") ?? 20 };
  if (mode.plan && (mode.watch || mode.once)) throw new Error(`--plan sends nothing, so it cannot go with ${mode.watch ? "--watch" : "--once"}`);
  if (mode.watch && mode.once) throw new Error("--once and --watch are separate runs");
  if (!mode.plan && !mode.watch && !mode.once) throw new Error("usage: --plan [N] | --once N | --watch");
  return mode;
}

export async function main(argv = process.argv.slice(2)) {
  let mode;
  try { mode = parseArgs(argv); } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  const cfg = loadConfig();
  const problem = configProblem(cfg);
  if (problem) { console.error(problem); process.exitCode = 2; return; }
  // The keeper's key has a free tier's quota and the proxy limits by IP:
  // the fleet on it could starve the keeper and the site.
  if (!mode.plan && cfg.keeperRpcUrl && cfg.rpcUrl === cfg.keeperRpcUrl) { console.error("SIM_RPC_URL is the keeper's RPC_URL: give the sim its own endpoint"); process.exitCode = 2; return; }
  const weights = parseWeights(cfg.personas);
  loadErrorNames(cfg.errorRs);

  const coins = COINS.map((c) => ({ ...c, mint: cfg.mints[c.symbol] ?? null }));
  if (!coins.some((c) => c.mint)) { console.error(`no devnet mints: set DEVNET_MINTS in ${join(cfg.dir, "sim.env")}`); process.exitCode = 2; return; }
  const treasury = existsSync(cfg.treasury) ? readKeypair(cfg.treasury) : null;
  if (!treasury && !mode.plan) { console.error(`no treasury key at ${cfg.treasury}`); process.exitCode = 2; return; }
  const faucet = faucetAuthority(cfg.faucetAuthority);

  const lock = mode.plan ? null : takeLock(join(cfg.dir, "lock"));
  if (!mode.plan && !lock) { console.error(`another sim run holds ${join(cfg.dir, "lock")}`); process.exitCode = 2; return; }
  const { wallets, made } = loadFleet(cfg.walletsDir, cfg.wallets, { create: !mode.plan });
  if (!mode.plan) {
    writeWalletList(join(cfg.dir, "wallets.txt"), wallets, wallets.map((w) => profileOf(w.index, weights, cfg.seed)));
    if (made) console.log(`generated ${made} wallets in ${cfg.walletsDir}`);
  }

  const bucket = new RpcBucket(cfg.rpcPerSec);
  const conn = makeConnection(cfg.rpcUrl, bucket);
  const reader = createReader({ conn, coins, siteUrl: cfg.siteUrl });
  const sender = createSender({ conn, plan: mode.plan, priority: cfg.priority, window: new TxWindow(cfg.txPerMin) });
  const statePath = join(cfg.dir, "state.json"), journalPath = join(cfg.dir, "journal.json");
  const state = readJson(statePath, {}), journal = readJson(journalPath, { wallets: {} });

  const sim = createSim({
    cfg, weights, wallets, treasury, faucet, reader, sender, conn, plan: mode.plan,
    rng: rngFrom(`${cfg.seed}:${Date.now()}`),
    state, journal,
    persist: (what) => (what === "journal" ? writeJson(journalPath, journal) : writeJson(statePath, state)),
    readWallets: (owners, world) => readWallets(conn, owners, world),
    readLamports: async (owners) => (await readAccounts(conn, owners)).map((a) => BigInt(a?.lamports ?? 0)),
    getBalance: async (k) => BigInt(await conn.getBalance(k)),
    log: mode.plan ? null : new JsonlLog(join(cfg.dir, "actions.jsonl"), { maxBytes: cfg.logMaxBytes, keep: cfg.logKeep }),
    issues: mode.plan ? null : new IssueBook(join(cfg.dir, "issues.jsonl")),
    alert: mode.plan ? null : shellAlert(cfg.alertSh),
  });

  if (mode.plan) {
    console.log(JSON.stringify({ plan: "config", rpc: new URL(cfg.rpcUrl).host, txPerMin: cfg.txPerMin, rpcPerSec: cfg.rpcPerSec, dailySol: cfg.dailySol, faucet: !!faucet, coins: coins.filter((c) => c.mint).map((c) => c.symbol) }));
    await sim.planRun(mode.n);
    console.log(JSON.stringify({ plan: "done", sent: sender.counts.sent, rpcRequests: bucket.requests }));
    return;
  }
  // On a signal nothing new is sent; a send in flight gets up to a minute
  // to confirm and be journaled, then the lock goes.
  const stop = () => {
    sim.stop();
    const t0 = Date.now();
    const tick = () => { if (!sender.busy || Date.now() - t0 > 60_000) { lock.release(); process.exit(0); } else setTimeout(tick, 200); };
    tick();
  };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  try {
    if (mode.once) {
      const done = await sim.once(mode.once);
      console.log(JSON.stringify({ once: done.length, sent: sender.counts, rpcRequests: bucket.requests }));
      return;
    }
    await sim.watch();
  } finally { lock.release(); }
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });

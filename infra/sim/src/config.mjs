// Settings for the fleet, from ~/sim/sim.env or the environment, with the
// defaults the box runs on. Nothing here reads a key; `wallets.mjs` does, and only the
// treasury's and the fleet's own.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The coins the fleet trades and the devnet stand-in feed each one's daily
 * series runs on (as `apps/stook/src/lib/coins.ts`). The mint is the devnet
 * twin, from DEVNET_MINTS; the mainnet mints are never used here.
 */
export const COINS = [
  { symbol: "STOOK", decimals: 6, feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", feed: "BTC" },
  { symbol: "ZCAT", decimals: 9, feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", feed: "ETH" },
  { symbol: "KNOTS", decimals: 6, feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", feed: "SOL" },
  { symbol: "GP", decimals: 6, feedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", feed: "DOGE" },
];

export const LAMPORTS = 1_000_000_000;

/** KEY=VALUE lines, `#` comments, one level of surrounding quotes removed. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    out[key] = v;
  }
  return out;
}

const num = (v, d) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

/** Why these settings cannot run, or null. A cap of 0 would make the sender spin, so it is refused. */
export function configProblem(cfg) {
  if (!(cfg.txPerMin > 0)) return "SIM_TX_PER_MIN must be above 0 (to stop the fleet, stop the service)";
  if (!(cfg.rpcPerSec > 0)) return "SIM_RPC_PER_SEC must be above 0";
  if (!(cfg.dailySol >= 0)) return "SIM_DAILY_SOL must be 0 or more";
  if (!(cfg.solTarget > cfg.solMin)) return "SIM_SOL_TARGET must be above SIM_SOL_MIN";
  if (!(cfg.solReclaim > cfg.solTarget)) return "SIM_SOL_RECLAIM must be above SIM_SOL_TARGET";
  if (!(cfg.maxPositionsPerRound > 0) || !(cfg.maxLinesPerClose > 0)) return "the line caps must be above 0";
  return null;
}

/**
 * Settings from `SIM_DIR/sim.env` first, then the environment, so a manual
 * `--plan` or `--once` (which sources only ~/stook.env) runs on the same
 * settings as the service. `SIM_DIR` itself comes from the environment.
 */
export function loadConfig(env = process.env) {
  const home = homedir();
  const dir = env.SIM_DIR ?? join(home, "sim");
  // sim.env also holds JSON values (the faucet key's bytes, the twin mints).
  // They are read from the file itself, since systemd's EnvironmentFile
  // rewrites quotes inside a value.
  let file = {};
  try { file = parseEnvFile(readFileSync(join(dir, "sim.env"), "utf8")); } catch { /* none yet */ }
  const pick = (k) => file[k] ?? env[k];
  let mints = {};
  try { mints = JSON.parse(pick("DEVNET_MINTS") || "{}"); } catch { mints = {}; }
  return {
    dir,
    walletsDir: join(dir, "wallets"),
    treasury: pick("SIM_TREASURY") ?? join(home, ".config/solana/sim-treasury.json"),
    /** The active fleet: wallets 0..SIM_WALLETS-1. Files past it on disk retire (sim.mjs). */
    wallets: Math.max(1, Math.floor(num(pick("SIM_WALLETS"), 100))),
    // Never the keeper's RPC_URL: that key's quota keeps rounds opening and
    // settling. The public endpoint unless SIM_RPC_URL names another.
    rpcUrl: pick("SIM_RPC_URL") || "https://api.devnet.solana.com",
    /** The keeper's endpoint, only to refuse sharing it. */
    keeperRpcUrl: env.RPC_URL || file.RPC_URL || "",
    siteUrl: (pick("SITE_URL") || "https://stookstreet.xyz").replace(/\/$/, ""),
    rpcPerSec: num(pick("SIM_RPC_PER_SEC"), 2),
    txPerMin: num(pick("SIM_TX_PER_MIN"), 4),
    /** Share of the cap the schedule aims for at its busiest (the cap still holds). */
    activity: num(pick("SIM_ACTIVITY"), 0.7),
    weekend: num(pick("SIM_WEEKEND"), 0.35),
    /** The app's priority fee (lib/chain.ts), so transactions expire as users' do. */
    priority: num(pick("SIM_PRIORITY_MICROLAMPORTS"), 50_000),
    // A wallet under SIM_SOL_MIN is topped up to SIM_SOL_TARGET; one over
    // SIM_SOL_RECLAIM sends everything above SIM_SOL_TARGET back. SIM_DAILY_SOL
    // caps the treasury's net outflow in a UTC day (sent less returned).
    solMin: num(pick("SIM_SOL_MIN"), 0.012),
    solTarget: num(pick("SIM_SOL_TARGET"), 0.04),
    solReclaim: num(pick("SIM_SOL_RECLAIM"), 0.06),
    dailySol: num(pick("SIM_DAILY_SOL"), 2),
    personas: pick("SIM_PERSONAS") ?? "",
    seed: pick("SIM_SEED") ?? "stook-sim",
    /** Most one buy may spend, as a share of the round's deposits (an arbitrageur's has its own, below). */
    maxDepthFrac: num(pick("SIM_MAX_DEPTH_FRAC"), 0.01),
    /** Share of buys that are whale-sized and ignore the edge and SIM_MAX_DEPTH_FRAC... */
    probeShare: num(pick("SIM_PROBE_SHARE"), 0.01),
    /** ...held to this share of the round's deposits instead. */
    probeDepthFrac: num(pick("SIM_PROBE_DEPTH_FRAC"), 0.05),
    /** Most one arbitrage trade may spend, as a share of the round's deposits. */
    arbDepthFrac: num(pick("SIM_ARB_DEPTH_FRAC"), 0.03),
    /** How far past fair (beyond the fees) a band's odds must be before an arbitrageur trades it. */
    arbMargin: num(pick("SIM_ARB_MARGIN"), 0.03),
    /** Bands under these fair odds are left alone; at most this many contiguous bands in one buy. */
    arbMinFair: num(pick("SIM_ARB_MIN_FAIR"), 0.005),
    arbMaxWidth: Math.max(1, Math.floor(num(pick("SIM_ARB_MAX_WIDTH"), 3))),
    /** Lines the arbitrageurs together hold in one round at most, apart from the caps above (so the keeper's sweep grows by this much at most). */
    arbLinesPerRound: num(pick("SIM_ARB_LINES_PER_ROUND"), 8),
    /** How much more often an arbitrageur takes the turn than its activity says, while a round trades. */
    arbTurnWeight: num(pick("SIM_ARB_TURN_WEIGHT"), 4),
    // The keeper sweeps each losing line after the close with its own
    // transaction, one after another, before its next heartbeat. These keep
    // the fleet's part of that sweep to a minute or two: at most this many
    // lines in one round, and across every round closing at the same time.
    maxPositionsPerRound: num(pick("SIM_MAX_POSITIONS_PER_ROUND"), 15),
    maxLinesPerClose: num(pick("SIM_MAX_LINES_PER_CLOSE"), 40),
    faucetUsd: num(pick("SIM_FAUCET_USD"), 1_000),
    faucetAuthority: pick("FAUCET_AUTHORITY") ?? pick("VITE_FAUCET_AUTHORITY_BYTES") ?? "",
    /** The test USDC the app's faucet also mints (VITE_QUOTE_MINT), when set. */
    quoteMint: pick("QUOTE_MINT") ?? pick("VITE_QUOTE_MINT") ?? "",
    mints,
    keeperBeat: pick("SIM_KEEPER_BEAT") ?? env.HEARTBEAT_FILE ?? join(home, "ladder-crank.beat"),
    beatMaxSecs: num(pick("SIM_BEAT_MAX_SECS"), 60),
    alertSh: pick("SIM_ALERT_SH") ?? join(home, "stook/infra/vps/alert.sh"),
    logMaxBytes: num(pick("SIM_LOG_MAX_BYTES"), 20 * 1024 * 1024),
    logKeep: num(pick("SIM_LOG_KEEP"), 3),
    /** Where the program's error enum is, to name a failure that landed on chain. */
    errorRs: pick("SIM_ERROR_RS") ?? new URL("../../../packages/programs-core/programs/sooth-core/src/error.rs", import.meta.url).pathname,
  };
}

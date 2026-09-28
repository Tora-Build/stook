// Settings: sim.env wins over the environment for every key, the keeper's
// RPC is never the fallback, and a cap of 0 is refused, not spun on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configProblem, loadConfig } from "../src/config.mjs";
import { main } from "../src/index.mjs";
import { RpcBucket } from "../src/rate.mjs";

const simDir = (text) => { const d = mkdtempSync(join(tmpdir(), "sim-cfg-")); writeFileSync(join(d, "sim.env"), text); return d; };

test("sim.env settings reach a manual run that sourced only stook.env", () => {
  const dir = simDir("SIM_RPC_URL=https://own.example\nSIM_WALLETS=100\nSIM_DAILY_SOL=5\nSIM_TX_PER_MIN=3\nSIM_PERSONAS=caller:1\n");
  const c = loadConfig({ SIM_DIR: dir, RPC_URL: "https://keeper-proxy.example", SIM_WALLETS: "200" });
  assert.equal(c.rpcUrl, "https://own.example");
  assert.equal(c.wallets, 100);
  assert.equal(c.dailySol, 5);
  assert.equal(c.txPerMin, 3);
  assert.equal(c.personas, "caller:1");
});

test("without SIM_RPC_URL the sim uses the public endpoint, never the keeper's", () => {
  const c = loadConfig({ SIM_DIR: simDir(""), RPC_URL: "https://keeper-proxy.example" });
  assert.equal(c.rpcUrl, "https://api.devnet.solana.com");
  assert.equal(c.keeperRpcUrl, "https://keeper-proxy.example");
});

test("the defaults keep the keeper's sweep short and use the app's priority fee", () => {
  const c = loadConfig({ SIM_DIR: simDir("") });
  assert.equal(c.maxPositionsPerRound, 15);
  assert.equal(c.maxLinesPerClose, 40);
  assert.equal(c.priority, 50_000);
  assert.equal(configProblem(c), null);
});

test("a cap of 0 is refused before anything runs", () => {
  const base = loadConfig({ SIM_DIR: simDir("") });
  assert.match(configProblem({ ...base, txPerMin: 0 }), /SIM_TX_PER_MIN/);
  assert.match(configProblem({ ...base, rpcPerSec: 0 }), /SIM_RPC_PER_SEC/);
  assert.throws(() => new RpcBucket(0), /above 0/);
});

test("--once refuses the keeper's RPC and a zero cap, and takes no lock", async () => {
  const saved = { ...process.env };
  try {
    const dir = simDir("SIM_RPC_URL=https://keeper-proxy.example\n");
    Object.assign(process.env, { SIM_DIR: dir, RPC_URL: "https://keeper-proxy.example" });
    process.exitCode = 0;
    await main(["--once", "1"]);
    assert.equal(process.exitCode, 2);
    assert.equal(existsSync(join(dir, "lock")), false);
    const zero = simDir("SIM_TX_PER_MIN=0\n");
    process.env.SIM_DIR = zero;
    process.exitCode = 0;
    await main(["--once", "1"]);
    assert.equal(process.exitCode, 2);
    assert.equal(existsSync(join(zero, "lock")), false);
  } finally {
    process.exitCode = 0;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("thrifty defaults, each still overridable, and a reclaim line above the target", () => {
  const c = loadConfig({ SIM_DIR: simDir("") });
  assert.equal(c.wallets, 100);
  assert.equal(c.solTarget, 0.04);
  assert.equal(c.solMin, 0.012);
  assert.equal(c.solReclaim, 0.06);
  assert.equal(c.dailySol, 2);
  const o = loadConfig({ SIM_DIR: simDir("SIM_SOL_RECLAIM=0.1\n"), SIM_WALLETS: "150", SIM_SOL_TARGET: "0.05", SIM_SOL_MIN: "0.02", SIM_DAILY_SOL: "4" });
  assert.deepEqual([o.wallets, o.solTarget, o.solMin, o.solReclaim, o.dailySol], [150, 0.05, 0.02, 0.1, 4]);
  assert.equal(configProblem(o), null);
  assert.match(configProblem({ ...c, solReclaim: 0.04 }), /SIM_SOL_RECLAIM/);
});

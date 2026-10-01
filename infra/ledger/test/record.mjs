#!/usr/bin/env node
// Record transactions as test fixtures, read only:
//   node test/record.mjs <name>=<signature> ...
// Each lands in test/fixtures/<name>.json exactly as getTransaction returns it
// (jsonParsed, maxSupportedTransactionVersion 0). Public devnet by default;
// LEDGER_RPC_URL to use another endpoint.

import { writeFileSync } from "node:fs";
import { makeRpc } from "../src/rpc.mjs";

const rpc = makeRpc({ url: process.env.LEDGER_RPC_URL || "https://api.devnet.solana.com", rps: 1, log: console.log });
for (const arg of process.argv.slice(2)) {
  const [name, sig] = arg.split("=");
  const tx = await rpc.call("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
  if (!tx) { console.log(`${name}: not found`); continue; }
  writeFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), JSON.stringify(tx, null, 1) + "\n");
  console.log(`${name}: ${sig.slice(0, 12)}… saved`);
}

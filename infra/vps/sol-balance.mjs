// The keeper wallet's SOL balance, for the watchdog and the daily check:
// plain JSON-RPC, no modules. KEYPAIR and RPC_URL from ~/stook.env.
//   node sol-balance.mjs [decimals]
import { readFileSync } from "node:fs";

// A Solana secret key file is 64 bytes: the seed, then the public key.
const key = Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR, "utf8"))).slice(32);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = 0n, address = "";
for (const b of key) n = n * 256n + BigInt(b);
for (; n > 0n; n /= 58n) address = B58[Number(n % 58n)] + address;
for (const b of key) { if (b !== 0) break; address = "1" + address; }

const r = await fetch(process.env.RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
}).then((x) => x.json());
console.log((r.result.value / 1e9).toFixed(Number(process.argv[2] ?? 3)));

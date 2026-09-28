// The fleet's keys: generated here on first run, one file per wallet
// (mode 0600, in a 0700 directory), and never printed. wallets.txt lists
// public keys only. The only other key read is the treasury's.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

export function readKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/**
 * The fleet's `count` wallets. Missing ones are generated and written when
 * `create` is set; otherwise (a plan) they are made up in memory for the
 * run and marked `ephemeral`, so a plan leaves no key on disk. Files past
 * `count` (a fleet made smaller) are loaded too, marked `retiring`, so what
 * they hold is still collected and their SOL comes back. In index order.
 */
export function loadFleet(dir, count, { create = true } = {}) {
  if (create) { mkdirSync(dir, { recursive: true, mode: 0o700 }); try { chmodSync(dir, 0o700); } catch {} }
  const out = [];
  let made = 0;
  for (let n = 0; n < count; n++) {
    const path = join(dir, `${n}.json`);
    if (existsSync(path)) { out.push({ index: n, keypair: readKeypair(path), ephemeral: false }); continue; }
    const kp = Keypair.generate();
    if (create) { writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 }); made++; }
    out.push({ index: n, keypair: kp, ephemeral: !create });
  }
  let past = [];
  try { past = readdirSync(dir).map((f) => /^(\d+)\.json$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).filter((n) => n >= count); } catch { /* no directory yet */ }
  for (const n of past.sort((a, b) => a - b)) out.push({ index: n, keypair: readKeypair(join(dir, `${n}.json`)), ephemeral: false, retiring: true });
  return { wallets: out, made };
}

/** wallets.txt: index, public key, persona, size and whether it is retiring, one per line. `profiles` in the order of `wallets`. */
export function writeWalletList(path, wallets, profiles) {
  const lines = wallets.map((w, n) => `${w.index}\t${w.keypair.publicKey.toBase58()}\t${profiles[n]?.persona ?? ""}\t${profiles[n]?.tier ?? ""}\t${w.retiring ? "retiring" : ""}`);
  writeFileSync(path, `# index\tpublic key\tpersona\tsize\tstate\n${lines.join("\n")}\n`, { mode: 0o644 });
}

/** The devnet faucet's mint authority (it can mint the test coins, nothing else). */
export function faucetAuthority(bytesJson) {
  if (!bytesJson) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(bytesJson))); } catch { throw new Error("FAUCET_AUTHORITY in sim.env is not a JSON byte array"); }
}

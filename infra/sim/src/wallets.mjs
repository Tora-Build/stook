// The fleet's keys: generated here on first run, one file per wallet
// (mode 0600, in a 0700 directory), and never printed. wallets.txt lists
// public keys only. The only other key read is the treasury's.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

export function readKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/**
 * The fleet's `count` wallets. Missing ones are generated and written when
 * `create` is set; otherwise (a plan) they are made up in memory for the
 * run and marked `ephemeral`, so a plan leaves no key on disk.
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
  return { wallets: out, made };
}

/** wallets.txt: index, public key and persona, one per line. */
export function writeWalletList(path, wallets, profiles) {
  const lines = wallets.map((w) => `${w.index}\t${w.keypair.publicKey.toBase58()}\t${profiles[w.index]?.persona ?? ""}\t${profiles[w.index]?.tier ?? ""}`);
  writeFileSync(path, `# index\tpublic key\tpersona\tsize\n${lines.join("\n")}\n`, { mode: 0o644 });
}

/** The devnet faucet's mint authority (it can mint the test coins, nothing else). */
export function faucetAuthority(bytesJson) {
  if (!bytesJson) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(bytesJson))); } catch { throw new Error("FAUCET_AUTHORITY in sim.env is not a JSON byte array"); }
}

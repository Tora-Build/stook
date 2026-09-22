#!/usr/bin/env node
// One-time devnet setup after `solana program deploy`:
//   1. initialise the protocol (authority = the deploying wallet, treasury = same)
//   2. create the mock USDC the demo quotes markets in (6 decimals), with a
//      fresh keypair as mint authority — the app's faucet uses it
//   3. mint 100,000 to the wallet
//   4. write apps/stook/.env.local
//
//   node scripts/devnet/setup.mjs
//
// ENV: RPC_URL (default devnet), KEYPAIR (default ~/.config/solana/id.json)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint } from "@solana/spl-token";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const ENV_FILE = resolve(import.meta.dirname, "../../apps/stook/.env.local");

const c = new Connection(RPC_URL, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
console.log("wallet", payer.publicKey.toBase58(), "program", SOOTH_CORE_PROGRAM_ID.toBase58());

const program = await c.getAccountInfo(SOOTH_CORE_PROGRAM_ID);
if (!program?.executable) throw new Error("program is not deployed at this id; run `solana program deploy` first");

// 1. protocol
const configKey = stook.deriveProtocolConfig();
if (await c.getAccountInfo(configKey)) {
  console.log("protocol already initialised:", stook.decodeProtocolConfig((await c.getAccountInfo(configKey)).data));
} else {
  const sig = await sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap([stook.initializeProtocolIx(payer.publicKey, payer.publicKey)])), [payer]);
  console.log("initialize_protocol", sig);
}

// 2. mock USDC — reuse the one in .env.local if it exists
let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const existing = env.match(/^VITE_QUOTE_MINT=(\S+)/m)?.[1];
let mint, authority;
if (existing && (await c.getAccountInfo(new (await import("@solana/web3.js")).PublicKey(existing)))) {
  const { PublicKey } = await import("@solana/web3.js");
  mint = new PublicKey(existing);
  authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.match(/^VITE_FAUCET_AUTHORITY_BYTES=(.+)$/m)[1])));
  console.log("mock USDC exists", mint.toBase58());
} else {
  const mintKp = Keypair.generate();
  authority = Keypair.generate();
  const rent = await getMinimumBalanceForRentExemptMint(c);
  const sig = await sendAndConfirmTransaction(c, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintKp.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mintKp.publicKey, 6, authority.publicKey, null, TOKEN_PROGRAM_ID),
  ), [payer, mintKp]);
  mint = mintKp.publicKey;
  console.log("mock USDC created", mint.toBase58(), sig);
}

// 3. fund the wallet
const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
await sendAndConfirmTransaction(c, new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint, TOKEN_PROGRAM_ID),
  createMintToInstruction(mint, ata, authority.publicKey, 100_000_000_000n, [], TOKEN_PROGRAM_ID),
), [payer, authority]);
console.log("minted 100,000 to", ata.toBase58());

// 4. env
const lines = {
  VITE_RPC_URL: RPC_URL,
  VITE_QUOTE_MINT: mint.toBase58(),
  VITE_FAUCET_AUTHORITY_BYTES: JSON.stringify(Array.from(authority.secretKey)),
};
for (const [k, v] of Object.entries(lines)) env = env.match(new RegExp(`^${k}=`, "m")) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : env + `${k}=${v}\n`;
writeFileSync(ENV_FILE, env);
console.log("wrote", ENV_FILE);

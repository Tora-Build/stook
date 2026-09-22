#!/usr/bin/env node
// Devnet twins of the street's coins: Token-2022 mints with the same decimals
// and the same transfer fee as the mainnet originals, so every fee path runs
// for real on devnet. The faucet authority (from apps/stook/.env.local) is the
// mint authority, so the app's faucet can hand them out. Each twin is approved
// as a quote mint (they are issuer-trusted: the fee authority is set).
//
//   node coins.mjs        creates any twin missing from .env.local, approves, mints 1M to the wallet
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, createInitializeMint2Instruction, createInitializeTransferFeeConfigInstruction, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook } from "@sooth/sdk-solana";

const COINS = [
  { symbol: "STOOK", decimals: 6, feeBps: 100 },
  { symbol: "ZCAT", decimals: 9, feeBps: 300 },
  { symbol: "KNOTS", decimals: 6, feeBps: 300 },
  { symbol: "GP", decimals: 6, feeBps: 100 },   // assumed until the mainnet mint is known
];
const ENV = new URL("../../apps/stook/.env.local", import.meta.url);
const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
let env = readFileSync(ENV, "utf8");
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.match(/^VITE_FAUCET_AUTHORITY_BYTES=(.+)$/m)[1])));
const twins = JSON.parse(env.match(/^VITE_DEVNET_MINTS=(.+)$/m)?.[1] ?? "{}");

for (const coin of COINS) {
  let mint = twins[coin.symbol] ? new PublicKey(twins[coin.symbol]) : null;
  if (!mint || !(await c.getAccountInfo(mint))) {
    const kp = Keypair.generate();
    const len = getMintLen([ExtensionType.TransferFeeConfig]);
    const rent = await c.getMinimumBalanceForRentExemption(len);
    await sendAndConfirmTransaction(c, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: kp.publicKey, lamports: rent, space: len, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeTransferFeeConfigInstruction(kp.publicKey, authority.publicKey, authority.publicKey, coin.feeBps, BigInt("1000000000000000"), TOKEN_2022_PROGRAM_ID),
      createInitializeMint2Instruction(kp.publicKey, coin.decimals, authority.publicKey, null, TOKEN_2022_PROGRAM_ID),
    ), [payer, kp]);
    mint = kp.publicKey; twins[coin.symbol] = mint.toBase58();
    console.log(`${coin.symbol}: twin created ${mint.toBase58()} (${coin.decimals} dp, ${coin.feeBps / 100}% fee)`);
  } else console.log(`${coin.symbol}: twin exists ${mint.toBase58()}`);

  if (!(await c.getAccountInfo(stook.deriveMintApproval(mint)))) {
    await sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap([stook.approveQuoteMintIx(payer.publicKey, mint)])), [payer]);
    console.log(`  approved as a quote mint`);
  }
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(c, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, ata, authority.publicKey, 1_000_000n * 10n ** BigInt(coin.decimals), [], TOKEN_2022_PROGRAM_ID),
  ), [payer, authority]);
  console.log(`  minted 1,000,000 to the wallet`);
}
const line = `VITE_DEVNET_MINTS=${JSON.stringify(twins)}`;
env = env.match(/^VITE_DEVNET_MINTS=/m) ? env.replace(/^VITE_DEVNET_MINTS=.*$/m, line) : env + line + "\n";
writeFileSync(ENV, env);
console.log("wrote VITE_DEVNET_MINTS");

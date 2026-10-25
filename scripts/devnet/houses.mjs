#!/usr/bin/env node
// Devnet houses from the CLI wallet: one per street coin's daily series.
//
//   node houses.mjs list                     each house: idle or in a round, capital, shares
//   node houses.mjs create                   a house for every coin that has none
//   node houses.mjs seed --amount 2000       mint test coins with the faucet and deposit them
//
// The keeper rolls a house from then on (infra/ladder-crank, houses()).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook } from "@sooth/sdk-solana";

const c = new Connection(process.env.RPC_URL ?? "https://soo-rpc.zak-a35.workers.dev", { commitment: "confirmed", wsEndpoint: process.env.WS_URL ?? "wss://api.devnet.solana.com/" });
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const env = readFileSync(new URL("../../apps/stook/.env.local", import.meta.url), "utf8");
const TWINS = JSON.parse(env.match(/^VITE_DEVNET_MINTS=(.+)$/m)?.[1] ?? "{}");
const faucet = () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.match(/^VITE_FAUCET_AUTHORITY_BYTES=(.+)$/m)[1])));
// Devnet stand-in feeds (apps/stook/src/lib/coins.ts): BTC, ETH, SOL, DOGE.
const FEEDS = { STOOK: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", ZCAT: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", KNOTS: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", GP: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c" };
const hex = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));
const send = (ixs, signers = [payer]) => sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap(ixs, 200_000)), signers);
const [cmd, ...rest] = process.argv.slice(2);
const arg = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };

async function coins() {
  const out = [];
  for (const [symbol, feed] of Object.entries(FEEDS)) {
    if (!TWINS[symbol]) continue;
    const mint = new PublicKey(TWINS[symbol]);
    const mintAcc = await c.getAccountInfo(mint);
    const series = stook.deriveSeries(hex(feed), mint, 0);
    const house = stook.deriveHouse(series);
    const h = await c.getAccountInfo(house);
    const report = stook.classifyMint(new Uint8Array(mintAcc.data), BigInt((await c.getEpochInfo()).epoch));
    out.push({ symbol, mint, tokenProgram: mintAcc.owner, decimals: mintAcc.data[44], series, house, h: h ? stook.decodeHouse(h.data) : null, report });
  }
  return out;
}

const fmt = (v, d) => (Number(v) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 2 });

if (cmd === "list" || !cmd) {
  for (const k of await coins()) {
    if (!k.h) { console.log(k.symbol, "no house"); continue; }
    console.log(k.symbol, k.house.toBase58(), k.h.round ? `in round ${k.h.round.toBase58().slice(0, 8)} with ${fmt(k.h.inRound, k.decimals)}, ${fmt(k.h.assets, k.decimals)} waiting` : `idle with ${fmt(k.h.assets, k.decimals)}`,
      `· fees per round ${fmt(k.h.feeEma, k.decimals)}`,
      `· epoch ${k.h.epoch} · queued in ${fmt(k.h.pendingDeposits, k.decimals)} · to claim ${fmt(k.h.claimable, k.decimals)}`);
  }
} else if (cmd === "create") {
  for (const k of await coins()) {
    if (k.h) { console.log(k.symbol, "has a house"); continue; }
    const sig = await send([stook.createHouseIx({ payer: payer.publicKey, series: k.series, quoteMint: k.mint, tokenProgram: k.tokenProgram, issuerTrusted: k.report.verdict === "issuer-trusted" })]);
    console.log(k.symbol, "house", k.house.toBase58(), sig);
  }
} else if (cmd === "seed") {
  const amount = Number(arg("amount", "2000"));
  const only = arg("coin", null)?.toUpperCase();
  const auth = faucet();
  for (const k of await coins()) {
    if (!k.h || (only && k.symbol !== only)) continue;
    const net = BigInt(Math.round(amount * 10 ** Math.min(k.decimals, 6))) * 10n ** BigInt(Math.max(k.decimals - 6, 0));
    const fee = k.report.transferFee;
    const gross = stook.maxGrossFor(net, [fee], 0n);
    const ata = getAssociatedTokenAddressSync(k.mint, payer.publicKey, false, k.tokenProgram);
    const refs = { house: k.house, quoteMint: k.mint, tokenProgram: k.tokenProgram };
    const stake = await c.getAccountInfo(stook.deriveHouseStake(k.house, payer.publicKey));
    const epoch = stook.epochFor(k.house, k.h, stake ? stook.decodeHouseStake(stake.data) : null);
    const sig = await send([
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, k.mint, k.tokenProgram),
      createMintToInstruction(k.mint, ata, auth.publicKey, gross, [], k.tokenProgram),
      stook.houseDepositIx(refs, payer.publicKey, ata, net, epoch, gross),
    ], [payer, auth]);
    console.log(k.symbol, `deposited ${fmt(net, k.decimals)}`, sig);
  }
} else {
  console.error("usage: houses.mjs list | create | seed --amount N [--coin SYMBOL]");
  process.exit(2);
}

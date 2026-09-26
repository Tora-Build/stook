#!/usr/bin/env node
// Devnet market operations from the CLI wallet.
//
//   node market.mjs create --coin STOOK [--day YYYY-MM-DD | --hourly] [--seed 2000]
//     a round of the coin's series, in its devnet twin: tomorrow's by default
//   node market.mjs open <ladder>      open from Pyth's push-oracle account, once it is fresh
//   node market.mjs list

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

const FEEDS = Object.fromEntries(JSON.parse(readFileSync(new URL("../../apps/stook/src/lib/feeds.json", import.meta.url), "utf8")).map((f) => [f.symbol, f.id]));
const PUSH = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const c = new Connection(process.env.RPC_URL ?? "https://soo-rpc.zak-a35.workers.dev", { commitment: "confirmed", wsEndpoint: process.env.WS_URL ?? "wss://api.devnet.solana.com/" });
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const env = readFileSync(new URL("../../apps/stook/.env.local", import.meta.url), "utf8");
const QUOTE = new PublicKey(env.match(/^VITE_QUOTE_MINT=(\S+)/m)[1]);
const TWINS = JSON.parse(env.match(/^VITE_DEVNET_MINTS=(.+)$/m)?.[1] ?? "{}");
const STREET = { // devnet stand-in feeds (see apps/stook/src/lib/coins.ts): BTC, ETH, SOL, DOGE
STOOK: ["e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", 6], ZCAT: ["ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", 9], KNOTS: ["ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", 6], GP: ["dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", 6] };
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? Number(rest[i + 1]) : dflt; };
const send = (ixs, signers = [payer]) => sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap(ixs, 250_000)), signers);
const hex = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

if (cmd === "create") {
  // A round of a coin's series: tomorrow's by default, `--day YYYY-MM-DD` for
  // another, or `--hourly` for the next hour of its hourly test series.
  const coin = (rest.includes("--coin") ? rest[rest.indexOf("--coin") + 1] : rest[0] ?? "").toUpperCase();
  if (!STREET[coin]) throw new Error(`--coin one of ${Object.keys(STREET).join(", ")}`);
  const [feed, dec] = STREET[coin];
  const quote = new PublicKey(TWINS[coin]);
  const hourly = rest.includes("--hourly");
  const series = stook.deriveSeries(hex(feed), quote, hourly ? 3600 : 0);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const dayArg = rest.includes("--day") ? rest[rest.indexOf("--day") + 1] : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const index = hourly ? Number(now / 3600n) + (now % 3600n > 2400n ? 2 : 1) : stook.daysFromCivil(...dayArg.split("-").map(Number));
  const s = stook.decodeSeries((await c.getAccountInfo(series)).data);
  const t = stook.roundTerms(s, index, now);
  const seed = BigInt(flag("seed", 2000)) * 10n ** BigInt(dec);
  // The most the seed may cost, at the coin's transfer fee now: a higher one
  // scheduled next fails the creation if it starts first, and is said.
  const fee = stook.classifyMint(new Uint8Array((await c.getAccountInfo(quote)).data), BigInt((await c.getEpochInfo()).epoch));
  if (stook.feeRaises(seed, fee.transferFee, fee.nextTransferFee)) console.warn(`the coin's transfer fee rises to ${fee.nextTransferFee.bps / 100}% at epoch ${fee.nextTransferFee.epoch}; if that comes first, this fails`);
  const sig = await send([stook.createLadderIx({
    series, index, quoteMint: quote, creator: payer.publicKey, creatorToken: getAssociatedTokenAddressSync(quote, payer.publicKey, false, TOKEN_2022_PROGRAM_ID),
    tokenProgram: TOKEN_2022_PROGRAM_ID, seed, maxGross: stook.maxGrossFor(seed, [fee.transferFee]), issuerTrusted: true,
  })]);
  console.log("started", stook.deriveLadderPda({ series, index }).toBase58(), `settles ${new Date(Number(t.settlesAt) * 1000).toISOString()} · bands ${(t.stepBps / 100).toFixed(2)}% · opens ${new Date(Number(t.opensAt) * 1000).toISOString()}`, sig);
} else if (cmd === "open") {
  const ladderKey = new PublicKey(rest[0]);
  const l = stook.decodeLadder((await c.getAccountInfo(ladderKey)).data);
  const [pda] = PublicKey.findProgramAddressSync([Uint8Array.of(0, 0), l.feedId], PUSH);
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const d = Buffer.from((await c.getAccountInfo(pda)).data);
    const at = d.indexOf(Buffer.from(l.feedId));
    const publishTime = Number(d.readBigInt64LE(at + 52)), age = now - publishTime;
    if (now < Number(l.opensAt)) { console.log(`opens in ${Number(l.opensAt) - now}s`); await new Promise((r) => setTimeout(r, 5000)); continue; }
    if (age > 55) { console.log(`push oracle ${age}s old, waiting for a fresh one`); await new Promise((r) => setTimeout(r, 10_000)); continue; }
    const refs = { ladder: ladderKey, quoteMint: l.quoteMint, tokenProgram: (await c.getAccountInfo(l.quoteMint)).owner };
    try {
      console.log("opened", await send([stook.openLadderIx(refs, payer.publicKey, pda, l.series)]));
      break;
    } catch (e) { console.log("open failed:", e.message.slice(0, 200)); await new Promise((r) => setTimeout(r, 5000)); }
  }
} else if (cmd === "list") {
  const accounts = await new Connection("https://api.devnet.solana.com").getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters() }); // scans: public endpoint
  for (const a of accounts) {
    const l = stook.decodeLadder(a.account.data);
    console.log(a.pubkey.toBase58(), l.status, "settles", new Date(Number(l.settlesAt) * 1000).toISOString(), "deposits", l.depositTotal, "trades", l.curveSeq);
  }
} else {
  console.log("usage: market.mjs create <SYM> | open <ladder> | list");
}

#!/usr/bin/env node
// Mainnet, after the program is deployed: the protocol, $SSt.'s daily series
// on Polymarket's PreStocks pool, seeded warm, and its house. Each step is
// skipped when already done; nothing is sent without a step's name.
//
//   node setup.mjs                 status: what exists, what each step would do
//   node setup.mjs init            initialize the protocol (the deploy key is the INITIALIZER)
//   node setup.mjs series          the daily series: 4 PM New York, on the pool
//   node setup.mjs seed            start it warm: the pool's price at the latest
//                                  close, and the variance of the pool's daily
//                                  closes (GeckoTerminal)
//   node setup.mjs house           the house that funds its rounds
//   node setup.mjs deposit <SSt.>  put the deploy key's SSt. in the house
//
// ENV: RPC_URL (default public mainnet), KEYPAIR (default ~/.config/solana/id.json),
//      STOOK_MINT (default VITE_STOOK_MINT from apps/stook/.env.local; the mint
//      stays out of the repo).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

const POOL = new PublicKey("5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs");   // POLYMARKET/USDC, Raydium CLMM
const c = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const envMint = () => readFileSync(new URL("../../apps/stook/.env.local", import.meta.url), "utf8").match(/^VITE_STOOK_MINT=(\S+)$/m)?.[1];
const MINT = new PublicKey(process.env.STOOK_MINT ?? envMint() ?? (() => { throw new Error("STOOK_MINT not set"); })());
const feedId = POOL.toBytes();
const series = stook.deriveSeries(feedId, MINT, 0);
const house = stook.deriveHouse(series);
const send = (ixs, units = 200_000) => sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap(ixs, units)), [payer]);
const exists = async (k) => !!(await c.getAccountInfo(k));

async function variance() {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL.toBase58()}/ohlcv/day?limit=60`, { headers: { accept: "application/json" } });
  const list = (await r.json()).data.attributes.ohlcv_list.slice().reverse();
  const closes = list.map((x) => x[4]);
  return { days: closes.length, varWad: stook.varianceFromCloses(closes) };
}

const [cmd = "status", arg] = process.argv.slice(2);
const program = await c.getAccountInfo(SOOTH_CORE_PROGRAM_ID);
console.log(`program ${SOOTH_CORE_PROGRAM_ID.toBase58()} ${program?.executable ? "deployed" : "NOT DEPLOYED"} · payer ${payer.publicKey.toBase58()} ${(await c.getBalance(payer.publicKey)) / 1e9} SOL`);
if (!program?.executable) process.exit(cmd === "status" ? 0 : 1);
const mint = await c.getAccountInfo(MINT);
const tokenProgram = mint.owner;

if (cmd === "init" && !(await exists(stook.deriveProtocolConfig()))) {
  console.log("init", await send([stook.initializeProtocolIx(payer.publicKey, payer.publicKey)]));
}
if (cmd === "series" && !(await exists(series))) {
  console.log("series", await send([stook.createSeriesIx({ authority: payer.publicKey, feedId, quoteMint: MINT, periodSecs: 0, closeSecs: 16 * 3600, clock: stook.CLOCK_NEW_YORK })]));
}
if (cmd === "seed") {
  const s = stook.decodeSeries((await c.getAccountInfo(series)).data);
  if (stook.warmedUp(s)) console.log("seed: already warm");
  else {
    const { days, varWad } = await variance();
    const p = stook.decodePool((await c.getAccountInfo(POOL)).data);
    console.log(`seed: ${days} daily closes, ${(Math.sqrt(Number(varWad) / 1e18) * 100).toFixed(2)}% a day`);
    console.log("seed", await send([stook.seriesSeedIx(payer.publicKey, series, POOL, p.observation, varWad)], 300_000));
  }
}
if (cmd === "house" && !(await exists(house))) {
  console.log("house", await send([stook.createHouseIx({ payer: payer.publicKey, series, quoteMint: MINT, tokenProgram })]));
}
if (cmd === "deposit") {
  const dec = mint.data[44];
  const amount = BigInt(Math.round(Number(arg) * 10 ** dec));
  if (!(amount > 0n)) throw new Error("deposit <amount of SSt.>");
  const from = getAssociatedTokenAddressSync(MINT, payer.publicKey, false, tokenProgram);
  console.log("deposit", await send([stook.houseDepositIx({ house, quoteMint: MINT, tokenProgram, series }, payer.publicKey, from, amount)]));
}

// Status, after any step.
const cfg = await c.getAccountInfo(stook.deriveProtocolConfig());
console.log("protocol", cfg ? "initialized" : "not initialized");
const sa = await c.getAccountInfo(series);
if (sa) {
  const s = stook.decodeSeries(sa.data);
  console.log(`series ${series.toBase58()} · ${stook.warmedUp(s) ? "warm" : "warming"} · ${(Math.sqrt(Number(stook.seriesVariance(s)) / 1e18) * 100).toFixed(2)}% a day · last close ${s.lastAt ? new Date(Number(s.lastAt) * 1000).toISOString() : "none"} at ${Number(s.lastPrice) / 1e8}`);
} else console.log("series none");
const ha = await c.getAccountInfo(house);
if (ha) { const h = stook.decodeHouse(ha.data); console.log(`house ${house.toBase58()} · holds ${Number(stook.houseCapital(h)) / 10 ** mint.data[44]} SSt. · ${h.round ? "in a round" : "idle"}`); }
else console.log("house none");

// Open each coin's daily series (protocol authority). A new series has no
// volatility: the keeper backfills its last closes from Pyth (series_observe)
// and it takes rounds once it has learned from twenty.
//
//   node series.mjs show                 every coin's series and what tomorrow's round would be
//   node series.mjs create               open the daily series that do not exist yet
//   node series.mjs create --hourly STOOK   also an hourly one, to watch a whole cycle in an hour
//
// ENV: RPC_URL (default public devnet), KEYPAIR (default ~/.config/solana/id.json)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";

const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", { commitment: "confirmed", wsEndpoint: process.env.WS_URL ?? "wss://api.devnet.solana.com/" });
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const env = readFileSync(new URL("../../apps/stook/.env.local", import.meta.url), "utf8");
const MINTS = JSON.parse(env.match(/VITE_DEVNET_MINTS=(.*)/)[1]);

// Devnet runs each coin on a crypto stand-in feed (see apps/stook/src/lib/coins.ts).
const COINS = {
  STOOK: { feed: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", yahoo: "BTC-USD" },
  ZCAT: { feed: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", yahoo: "ETH-USD" },
  KNOTS: { feed: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", yahoo: "SOL-USD" },
  GP: { feed: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c", yahoo: "DOGE-USD" },
};
const hexBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

const cmd = process.argv[2] ?? "show";
const hourly = process.argv.includes("--hourly") ? process.argv[process.argv.indexOf("--hourly") + 1] : null;
const now = BigInt(Math.floor(Date.now() / 1000));

for (const [coin, { feed }] of Object.entries(COINS)) {
  const mint = new PublicKey(MINTS[coin]);
  const periods = [0, ...(hourly === coin ? [3600] : [])];
  for (const period of periods) {
    const key = stook.deriveSeries(hexBytes(feed), mint, period);
    const info = await c.getAccountInfo(key);
    const label = `${coin.padEnd(6)} ${period ? "hourly" : "daily "} ${key.toBase58()}`;
    if (info) {
      const s = stook.decodeSeries(info.data);
      const next = period ? Number(now / 3600n) + 1 : stook.daysFromCivil(...new Date(Date.now() + 86_400_000).toISOString().slice(0, 10).split("-").map(Number));
      const t = stook.roundTerms(s, next, now);
      console.log(label, `σ ${(Math.sqrt(Number(s.varWad) / 1e18) * 100).toFixed(2)}%/day · ${s.observations}/${stook.WARMUP_OBSERVATIONS} closes learned · next round: bands ${(t.stepBps / 100).toFixed(2)}%, grid −${((1 - Math.exp(-31 * t.stepBps / 1e4)) * 100).toFixed(0)}% to +${((Math.exp(31 * t.stepBps / 1e4) - 1) * 100).toFixed(0)}%${s.active ? "" : " · PAUSED"}`);
      continue;
    }
    if (cmd !== "create") { console.log(label, "not created"); continue; }
    const ix = stook.createSeriesIx({
      authority: payer.publicKey, feedId: hexBytes(feed), quoteMint: mint, periodSecs: period,
      closeSecs: period ? 0 : 16 * 3600, clock: period ? stook.CLOCK_UTC : stook.CLOCK_NEW_YORK,
    });
    const sig = await sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap([ix])), [payer]);
    console.log(label, "created; learning from Pyth closes", sig);
  }
}

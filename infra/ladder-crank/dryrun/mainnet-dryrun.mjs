// The mainnet build's dry run, against the local validator mainnet-dryrun.sh
// starts. Every step is the keeper's own code (createKeeper); only the price
// source is mainnet's chain history.
//
//   learn  a daily ZEC series learns its past closes from mainnet history, at once
//   round  a five-minute ZEC series warms up, a house funds a round, the keeper
//          opens it, a call is bought, the keeper settles it and the house
//          collects it; the push feed is kept live by replaying mainnet's
//          updates into it
//   all    both

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Wallet } from "@coral-xyz/anchor";
import { stook } from "@sooth/sdk-solana";
import pyth from "../src/pyth.cjs";
import { createKeeper, chainSenders, pushPrices } from "../src/index.mjs";
import { historyPrices } from "../src/history.mjs";

const ZEC = "be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24";
const feedBytes = Uint8Array.from(Buffer.from(ZEC, "hex"));
const local = new Connection("http://127.0.0.1:8899", { commitment: "confirmed", wsEndpoint: "ws://127.0.0.1:8900" });
const mainnet = new Connection(process.env.HISTORY_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const history = historyPrices(mainnet);
const keeper = createKeeper({ connection: local, scanner: local, payer, ...chainSenders(local, payer), hermes: pushPrices(local), history });
const send = (...ixs) => sendAndConfirmTransaction(local, new Transaction().add(...stook.withHeap(ixs, 400_000)), [payer]);
const seriesNow = async (key) => stook.decodeSeries((await local.getAccountInfo(key)).data);
const sigma = (s) => `${(Math.sqrt(Number(stook.seriesVariance(s)) / 1e18) * 100).toFixed(2)}%/day`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

async function setup() {
  if (!(await local.getAccountInfo(stook.deriveProtocolConfig()))) {
    await send(stook.initializeProtocolIx(payer.publicKey, payer.publicKey));
    log("protocol initialised by the deploy key (the mainnet build's INITIALIZER)");
  }
  // A plain coin: classic SPL, no freeze authority (the program refuses one).
  const mint = await createMint(local, payer, payer.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(local, payer, mint, payer.publicKey);
  await mintTo(local, payer, mint, ata.address, payer, 10n ** 15n);
  return { mint, token: ata.address };
}

/** Learn until the series is warmed up and has the latest close, or `minutes` pass; returns it. */
async function learnAll(key, label, minutes = 25) {
  const deadline = Date.now() + minutes * 60_000;
  let last = -1;
  for (;;) {
    await keeper.learn();
    const s = await seriesNow(key);
    if (s.observations !== last) log(label, `${s.observations} closes learned, σ ${sigma(s)}${stook.warmedUp(s) ? " · warmed up" : ""}`);
    last = s.observations;
    const latest = stook.closeOf(s, stook.indexAtOrBefore(s, BigInt(Math.floor(Date.now() / 1000))));
    if ((stook.warmedUp(s) && s.lastAt >= latest) || Date.now() > deadline) return s;
    // The keeper backs off a close whose read failed (a free RPC's 429); wait it out.
    await sleep(5_000);
  }
}

async function learnPart(mint) {
  const series = stook.deriveSeries(feedBytes, mint, 0);
  await send(stook.createSeriesIx({ authority: payer.publicKey, feedId: feedBytes, quoteMint: mint, periodSecs: 0, closeSecs: 16 * 3600, clock: stook.CLOCK_NEW_YORK }));
  log("daily ZEC series created (4 PM New York), learning from mainnet history");
  const s = await learnAll(series, "daily");
  const ok = stook.warmedUp(s);
  log(ok ? "PASS" : "FAIL", `daily series: ${s.observations} closes, σ ${sigma(s)}, last close ${new Date(Number(s.lastAt) * 1000).toISOString()}`);
  return ok;
}

/** Keep the local push feed live: post each newer mainnet update into it, as Pyth's pusher does on mainnet. */
function replayPushFeed() {
  let lastPublish = Math.floor(Date.now() / 1000) - 120, stop = false, posted = 0;
  const receiver = new pyth.PythSolanaReceiver({ connection: local, wallet: new Wallet(payer) });
  (async () => {
    while (!stop) {
      try {
        const r = await history(`/v2/updates/price/${lastPublish + 1}`, ZEC);
        if (r.parsed) {
          const b = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
          await b.addUpdatePriceFeed(r.vaas.rebuilt, 0);
          await receiver.provider.sendAll(await b.buildVersionedTransactions({ computeUnitPriceMicroLamports: 1 }), { skipPreflight: false });
          lastPublish = r.parsed.price.publish_time;
          posted++;
        }
      } catch (e) { log("replay:", String(e?.message ?? e).slice(0, 160)); }
      await sleep(10_000);
    }
  })();
  return { stop: () => { stop = true; }, posted: () => posted, lastPublish: () => lastPublish };
}

async function roundPart(mint, token) {
  const PERIOD = 300;
  const series = stook.deriveSeries(feedBytes, mint, PERIOD);
  await send(stook.createSeriesIx({ authority: payer.publicKey, feedId: feedBytes, quoteMint: mint, periodSecs: PERIOD, closeSecs: 0, clock: stook.CLOCK_UTC }));
  log("five-minute ZEC series created, learning from mainnet history");
  const warm = await learnAll(series, "5-min");
  if (!stook.warmedUp(warm)) { log("FAIL", "the five-minute series did not warm up"); return false; }

  const house = stook.deriveHouse(series);
  await send(stook.createHouseIx({ payer: payer.publicKey, series, quoteMint: mint, tokenProgram: TOKEN_PROGRAM_ID }));
  const refs = { house, quoteMint: mint, tokenProgram: TOKEN_PROGRAM_ID, series };
  await send(stook.houseDepositIx(refs, payer.publicKey, token, 1_000_000n * 10n ** 6n));
  log("house created and seeded with 1,000,000 test coins");

  const replay = replayPushFeed();
  let bought = false, round = null;
  const deadline = Date.now() + 50 * 60_000;
  try {
    while (Date.now() < deadline) {
      await keeper.learn();
      await keeper.pass();
      const h = stook.decodeHouse((await local.getAccountInfo(house)).data);
      if (h.round && !round) { round = h.round; log("house started round", round.toBase58().slice(0, 8), `with ${h.inRound} of ${stook.houseCapital(h)}`); }
      const l = round ? (await local.getAccountInfo(round).then((a) => a && stook.decodeLadder(a.data))) : null;
      if (l && l.status === "open" && !bought) {
        const r = stook.ladderRefs(round, l, TOKEN_PROGRAM_ID);
        const shape = { lo: 30, hi: 34, h: 3 };
        await sendAndConfirmTransaction(local, new Transaction().add(...stook.withHeap([stook.tradeLadderIx(r, { user: payer.publicKey, userToken: token, shape, shares: 1_000n * 10n ** 6n, limit: 10n ** 13n })], stook.tradeComputeUnits(shape))), [payer]);
        bought = true;
        log("round open at", l.p0.toString(), `(expo ${l.p0Expo}); bought a call on floors 30 to 34`);
      }
      if (round && !h.round && h.epoch > 0) {
        const after = l ?? null;
        log("PASS", `house collected the round: epoch ${h.epoch}, holds ${stook.houseCapital(h)}, fees per round ${h.feeEma}`, after ? `round ${after.status}` : "round closed");
        return true;
      }
      if (l && (l.status === "settled" || l.status === "void")) log("round", l.status, l.status === "settled" ? `on floor ${l.settledBin}` : "");
      await sleep(10_000);
    }
    log("FAIL", "no settled, collected round within 50 minutes");
    return false;
  } finally {
    replay.stop();
    log(`replayed ${replay.posted()} mainnet updates into the push feed`);
  }
}

const what = process.argv[2] ?? "all";
const { mint, token } = await setup();
const results = [];
if (what === "learn" || what === "all") results.push(await learnPart(mint));
if (what === "round" || what === "all") results.push(await roundPart(mint, token));
log(results.every(Boolean) ? "DRY RUN PASSED" : "DRY RUN FAILED");
process.exit(results.every(Boolean) ? 0 : 1);

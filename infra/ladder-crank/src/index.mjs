#!/usr/bin/env node
// Keeper for Stook ladders.
//
//   node src/index.mjs --plan     list what each market is waiting for; send nothing
//   node src/index.mjs            do one pass
//   node src/index.mjs --watch    pass every CRANK_INTERVAL_SECS (default 5)
//
// Every decision is made by `@sooth/sdk-solana`'s `stook.nextStep`,
// `stook.openProblem` and `stook.settlementProblem`, which are unit-tested.
// This file is the I/O around them: read ladders, ask Hermes, post the update
// through the Pyth receiver, and consume it in the same transaction.
//
// Nothing here is privileged. Anyone may run it; which price settles a market
// is fixed by the program's rule, not by who cranks.
//
// ENV
//   RPC_URL              Solana RPC (default devnet)
//   KEYPAIR              fee payer, path to a JSON keypair (default ~/.config/solana/id.json)
//   PYTH_API_KEY         Hermes has required one since 2026-08-26
//   HERMES_URL           default https://hermes.pyth.network
//   FULL_VERIFICATION=1  post fully verified updates. Required on mainnet, where
//                        the program accepts nothing less; devnet accepts partial.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { Connection, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Wallet, utils as anchorUtils } from "@coral-xyz/anchor";
const bs58 = (b) => anchorUtils.bytes.bs58.encode(Buffer.from(b));
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

// The receiver's ESM build imports `jito-ts/dist/sdk/block-engine/types`
// without an extension, which Node's ESM loader refuses. Its CJS build is fine.
const { PythSolanaReceiver } = createRequire(import.meta.url)("@pythnetwork/pyth-solana-receiver");

const args = new Set(process.argv.slice(2));
const RPC_URL = process.env.RPC_URL ?? "https://soo-rpc.zak-a35.workers.dev";
const HERMES = (process.env.HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, "");
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const INTERVAL = Number(process.env.CRANK_INTERVAL_SECS ?? 5) * 1000;
const FULL = process.env.FULL_VERIFICATION === "1";

// Reads and sends go through RPC_URL; confirmations subscribe over a
// websocket, which an HTTP proxy cannot carry, so that stays on the public
// endpoint.
const connection = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: process.env.WS_URL ?? "wss://api.devnet.solana.com/" });
// Scanning for markets needs getProgramAccounts, which keyed free tiers refuse;
// the public endpoint serves it fine at one scan per pass.
const scanner = new Connection(process.env.SCAN_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
const hex = (b) => Buffer.from(b).toString("hex");
// Priority fee per compute unit. Devnet is not congested; mainnet may want more.
const PRIORITY = Number(process.env.PRIORITY_MICROLAMPORTS ?? 1_000);

async function hermes(path, feedId) {
  if (!process.env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not set; Hermes answers 401 without it");
  const res = await fetch(`${HERMES}${path}?ids%5B%5D=${feedId}&encoding=base64`, {
    headers: { authorization: `Bearer ${process.env.PYTH_API_KEY}` },
  });
  if (!res.ok) throw new Error(`hermes ${path}: ${res.status}`);
  const body = await res.json();
  return { parsed: body.parsed?.[0], vaas: body.binary?.data ?? [] };
}

/**
 * Post `vaas`, run our instruction against the posted account, close the
 * account. Three transactions on purpose. The receiver's builder batches
 * instructions by byte size, and once our instruction did not fit beside the
 * VAA post it was moved to a transaction of its own — without the heap frame
 * it needs. So the builder only posts; the consume transaction is ours.
 */
async function postAndConsume(vaas, feedHex, makeIxs) {
  const receiver = new PythSolanaReceiver({ connection, wallet: new Wallet(payer) });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
  if (FULL) await builder.addPostPriceUpdates(vaas);
  else await builder.addPostPartiallyVerifiedPriceUpdates(vaas);
  const priceUpdate = builder.getPriceUpdateAccount(`0x${feedHex}`);
  const posted = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: PRIORITY });

  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  try {
    await receiver.provider.sendAll(posted, { skipPreflight: false });
    return await sendAndConfirmTransaction(connection, new Transaction().add(...stook.withHeap(makeIxs(priceUpdate), 200_000, PRIORITY)), [payer]);
  } finally {
    // Rent back, whether or not the consume (or part of the post) landed:
    // the price update account and, when fully verified, the encoded VAA the
    // builder collected close instructions for. One per transaction, so a
    // close of an account that never landed fails alone.
    for (const { instruction } of builder.closeInstructions) {
      await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer]).catch((e) => console.error("close update account:", e?.message));
    }
  }
}

// A step the program keeps refusing is not retried every pass: each failure
// doubles the wait, from 30 s up to ten minutes. A success clears it.
const backoff = new Map();
const waiting = (key) => (backoff.get(key)?.until ?? 0) > Date.now();
const failed = (key) => {
  const n = (backoff.get(key)?.n ?? 0) + 1;
  backoff.set(key, { n, until: Date.now() + Math.min(30_000 * 2 ** (n - 1), 600_000) });
};
const succeeded = (key) => backoff.delete(key);

async function sendPlain(ix, units) {
  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  return sendAndConfirmTransaction(connection, new Transaction().add(...stook.withHeap([ix], units)), [payer]);
}

async function pass() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const found = [];
  const seriesCache = new Map();
  const seriesOf = async (key) => {
    const k = key.toBase58();
    if (!seriesCache.has(k)) { const a = await connection.getAccountInfo(key); seriesCache.set(k, a ? stook.decodeSeries(a.data) : null); }
    return seriesCache.get(k);
  };
  for (const status of ["seeding", "open"]) {
    const accounts = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters(status) });
    for (const a of accounts) found.push({ pubkey: a.pubkey, ladder: stook.decodeLadder(a.account.data) });
  }

  for (const { pubkey, ladder } of found) {
    const step = stook.nextStep(ladder, now);
    if (!step) continue;
    const tag = `${pubkey.toBase58().slice(0, 8)} ${step}`;
    if (args.has("--plan")) { console.log(tag); continue; }
    const key = `${pubkey.toBase58()}:${step}`;
    if (waiting(key)) continue;

    try {
      // An open the program would refuse costs a Pyth post and a close for
      // nothing: wait until the series has warmed up and learned the close
      // before this round's opening.
      if (step === "open") {
        const s = await seriesOf(ladder.series);
        const why = s ? stook.openBlocker(s, ladder.opensAt, now) : "series not found";
        if (why) { console.log(tag, "waiting:", why); continue; }
      }
      // Whichever token program owns the mint — classic SPL or Token-2022.
      const mint = await connection.getAccountInfo(ladder.quoteMint);
      if (!mint) { console.log(tag, "quote mint not found"); continue; }
      const refs = { ladder: pubkey, quoteMint: ladder.quoteMint, tokenProgram: mint.owner };
      if (step === "void") {
        console.log(tag, await sendPlain(stook.voidLadderIx(refs, payer.publicKey)));
        succeeded(key);
        continue;
      }
      const feed = hex(ladder.feedId);
      // For an open, the update from a few seconds ago rather than "latest":
      // Hermes stamps ahead of a lagging machine or cluster clock, and the
      // program refuses a price from the future. 15s is well inside the 60s
      // the program allows.
      const { parsed, vaas } = step === "open"
        ? await hermes(`/v2/updates/price/${Number(now) - 15}`, feed)
        : await hermes(`/v2/updates/price/${ladder.settlesAt}`, feed);
      if (!parsed) { console.log(tag, "hermes returned no update"); continue; }

      const problem = step === "open" ? stook.openProblem(parsed, ladder, now) : stook.settlementProblem(parsed, ladder);
      // Not an error: a market whose feed was silent across its settlement time
      // is SUPPOSED to be unsettleable, and will void after the grace period.
      if (problem) { console.log(tag, "skipped:", problem); continue; }

      if (step === "open") {
        console.log(tag, await postAndConsume(vaas, feed, (price) => [stook.openLadderIx(refs, payer.publicKey, price, ladder.series)]));
        succeeded(key);
      } else {
        // The settler is paid in the market's quote token. The token account is
        // made in its own transaction first: adding it beside the settle
        // instruction pushed the Pyth builder to split the transaction, and
        // the settle landed without its heap frame.
        const ata = getAssociatedTokenAddressSync(ladder.quoteMint, payer.publicKey, false, mint.owner);
        if (!(await connection.getAccountInfo(ata))) {
          const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
          await sendAndConfirmTransaction(connection, new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, ladder.quoteMint, mint.owner)), [payer]);
        }
        console.log(tag, await postAndConsume(vaas, feed, (price) => [stook.settleLadderIx(refs, ladder.series, payer.publicKey, price, ata)]));
        succeeded(key);
      }
    } catch (e) {
      console.error(tag, "failed:", e?.message ?? e);
      failed(key);
    }
  }
}

// A finished round keeps its rent and a few base units of dust until it is
// closed, and it can close only once nothing in it is owed. Winners collect
// their own; the positions nobody would bother to collect (a miss, a line
// sold to zero) are swept, rent to their owners; the fee shares are sent to
// their fixed homes; then the round closes, dust to the treasury, rent to
// whoever funded it. Every step is permissionless and pays nobody here.
async function clearUp() {
  const config = stook.decodeProtocolConfig((await connection.getAccountInfo(stook.deriveProtocolConfig())).data);
  for (const status of ["settled", "void"]) {
    const rounds = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters(status) });
    for (const { pubkey, account } of rounds) {
      const l = stook.decodeLadder(account.data);
      const tag = `${pubkey.toBase58().slice(0, 8)} clear`;
      try {
        const mint = await connection.getAccountInfo(l.quoteMint);
        const refs = { ladder: pubkey, quoteMint: l.quoteMint, tokenProgram: mint.owner };
        // 30 days after the close, anything still uncollected is paid out to
        // its owner's token account, if they have one. The keeper does not
        // open token accounts for others: the owner could close it and keep
        // the rent, so it would be a way to drain the keeper. An owner with no
        // account collects it themselves, whenever they like.
        const graceOver = BigInt(Math.floor(Date.now() / 1000)) >= l.settlesAt + stook.CLAIM_GRACE_SECS;
        const ownerToken = async (owner) => {
          const ata = getAssociatedTokenAddressSync(l.quoteMint, owner, true, mint.owner);
          return (await connection.getAccountInfo(ata)) ? ata : null;
        };
        let open = l.openPositions, tranches = l.openTranches;
        if (open > 0) {
          const positions = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.positionFilters(pubkey) });
          for (const p of positions) {
            const pos = stook.decodeLadderPosition(p.account.data);
            if (stook.owedTo(l, pos) === 0n) {
              await sendPlain(stook.sweepPositionIx(refs, payer.publicKey, p.pubkey, pos.owner));
              console.log(tag, "swept", p.pubkey.toBase58().slice(0, 8));
            } else if (graceOver) {
              const to = await ownerToken(pos.owner);
              if (!to) continue;
              await sendPlain(stook.redeemLadderIx(refs, pos.owner, to, pos.shape, payer.publicKey));
              console.log(tag, "paid out uncollected position to", pos.owner.toBase58().slice(0, 8));
            } else continue;
            open--;
          }
        }
        if (tranches > 0 && graceOver) {
          const ts = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.trancheFilters(pubkey) });
          for (const t of ts) {
            const tr = stook.decodeLadderTranche(t.account.data);
            const to = await ownerToken(tr.owner);
            if (!to) continue;
            await sendPlain(stook.claimLpIx(refs, tr.owner, to, tr.index, payer.publicKey), stook.claimComputeUnits(l, tr));
            console.log(tag, "paid out unclaimed deposit to", tr.owner.toBase58().slice(0, 8));
            tranches--;
          }
        }
        if (open > 0 || tranches > 0) continue;
        const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
        const treasuryToken = getAssociatedTokenAddressSync(l.quoteMint, config.treasury, true, mint.owner);
        const creatorToken = getAssociatedTokenAddressSync(l.quoteMint, l.creator, true, mint.owner);
        await sendAndConfirmTransaction(connection, new Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, treasuryToken, config.treasury, l.quoteMint, mint.owner),
          ...(l.feesCreator + l.feesProtocol > 0n ? [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, creatorToken, l.creator, l.quoteMint, mint.owner)] : [])), [payer]);
        if (l.feesCreator + l.feesProtocol > 0n) await sendPlain(stook.collectLadderFeesIx(refs, payer.publicKey, creatorToken, treasuryToken));
        console.log(tag, "closed", await sendPlain(stook.closeLadderIx(refs, payer.publicKey, l.creator, treasuryToken)));
      } catch (e) {
        console.error(tag, "failed:", e?.message ?? e);
      }
    }
  }
}

// Every series learns from every day's close, whether or not a round ran:
// for each close it has not seen, fetch the Pyth update that is the price at
// that second (Hermes keeps history) and submit it. The program checks it
// against the settlement rule, so what is submitted is not a choice. A close
// Pyth was silent across can never be submitted; it is skipped here and the
// series learns from the next one. A new series backfills its first closes
// from history, so it can take rounds as soon as it has twenty.
const unobservable = new Set();
async function learn() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const all = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: [
    { dataSize: stook.SERIES_SIZE },
    { memcmp: { offset: 0, bytes: bs58(stook.SERIES_DISCRIMINATOR) } },
  ] });
  for (const { pubkey, account } of all) {
    const s = stook.decodeSeries(account.data);
    const feed = hex(s.feedId);
    // Closes are taken strictly in order, each from the one Pyth update that
    // is its price; the program decides whether it teaches a return or only
    // moves the series on. A close whose update cannot be posted at all
    // (retired guardian set) can be passed only by a warmed-up series, once
    // it is a week old; until then, wait.
    let skippedAt = 0n;
    for (const index of stook.pendingObservations(s, now, 10)) {
      const key = `${pubkey.toBase58()}:${index}`;
      const at = stook.closeOf(s, index);
      if (unobservable.has(key)) { skippedAt = at; continue; }
      if (skippedAt && (!stook.warmedUp(s) || skippedAt > now - stook.SKIP_AFTER_SECS) && s.lastAt > 0n) break;
      if (waiting(key)) break;
      const tag = `${pubkey.toBase58().slice(0, 8)} observe ${new Date(Number(at) * 1000).toISOString()}`;
      try {
        const { parsed, vaas } = await hermes(`/v2/updates/price/${at}`, feed);
        // Hermes answering without the update, or without its predecessor's
        // time, is a glitch to retry, not a close to give up on.
        if (!parsed?.metadata?.prev_publish_time || !(BigInt(parsed.metadata.prev_publish_time) < at && at <= BigInt(parsed.price.publish_time))) {
          console.log(tag, "hermes has no usable update yet; retrying later"); failed(key); break;
        }
        // An RPC node that has not seen the blockhash yet refuses the
        // simulation; that clears in seconds, so try again at once.
        for (let attempt = 0; ; attempt++) {
          try {
            console.log(tag, await postAndConsume(vaas, feed, (price) => [stook.observeSeriesIx(pubkey, payer.publicKey, price, index)]));
            succeeded(key);
            break;
          } catch (e) {
            if (attempt < 4 && /Blockhash not found|block height exceeded/i.test(String(e?.message ?? e))) { await new Promise((r) => setTimeout(r, 2500)); continue; }
            throw e;
          }
        }
      } catch (e) {
        const why = `${e?.message ?? e} ${(e?.logs ?? []).join(" ")}`;
        // Some closes can never be verified: signed by a Wormhole guardian set
        // the receiver no longer accepts, or not the settlement instant after
        // all. Skip those for good; retry anything else next pass, in order.
        if (/GuardianSetExpired|OracleWrongFeed|SeriesAlreadyObserved/.test(why)) {
          unobservable.add(key);
          skippedAt = at;
          console.log(tag, "skipped for good:", (why.match(/Error Code: (\w+)/) ?? [])[1] ?? "unverifiable");
          continue;
        }
        console.error(tag, "failed:", e?.message ?? e);
        failed(key);
        break;
      }
    }
  }
}

if (args.has("--watch")) {
  for (let n = 0; ; n++) {
    // Learn first, so a round opening at yesterday's close opens on a
    // series that has already counted it.
    if (n % 4 === 0) await learn().catch((e) => console.error("learn failed:", e?.message ?? e));
    await pass().catch((e) => console.error("pass failed:", e?.message ?? e));
    // finished rounds are not urgent: every ten passes
    if (n % 10 === 0) await clearUp().catch((e) => console.error("clear-up failed:", e?.message ?? e));
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
} else {
  if (args.has("--learn")) await learn();
  await pass();
  if (args.has("--clear-up")) await clearUp();
}

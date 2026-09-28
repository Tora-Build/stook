#!/usr/bin/env node
// Keeper for Stook ladders.
//
//   node src/index.mjs --plan     list what each market is waiting for; send nothing
//   node src/index.mjs            do one pass
//   node src/index.mjs --watch    pass every CRANK_INTERVAL_SECS (default 5)
//
// `--plan` goes alone: with --learn, --clear-up or --watch it is refused,
// since those would send. Every send also goes through one guard that
// refuses in plan mode, so no path can slip past it.
//
// Every decision is made by `@sooth/sdk-solana`'s `stook.nextStep`,
// `stook.openProblem` and `stook.settlementProblem`, which are unit-tested.
// This file is the I/O around them: read ladders, ask Hermes, post the update
// through the Pyth receiver, and consume it in a transaction of our own.
//
// Nothing here is privileged. Anyone may run it; which price settles a market
// is fixed by the program's rule, not by who cranks.
//
// ENV
//   RPC_URL              Solana RPC (default: the devnet proxy, infra/rpc-proxy)
//   KEYPAIR              fee payer, path to a JSON keypair (default ~/.config/solana/id.json)
//   PYTH_API_KEY         Hermes has required one since 2026-08-26
//   HERMES_URL           default https://hermes.pyth.network
//   FULL_VERIFICATION=1  post fully verified updates. Required on mainnet, where
//                        the program accepts nothing less; devnet accepts partial.

import { appendFileSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Wallet, utils as anchorUtils } from "@coral-xyz/anchor";
const bs58 = (b) => anchorUtils.bytes.bs58.encode(Buffer.from(b));
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

// The receiver's ESM build imports `jito-ts/dist/sdk/block-engine/types`
// without an extension, which Node's ESM loader refuses. Its CJS build is fine.
const { PythSolanaReceiver } = createRequire(import.meta.url)("@pythnetwork/pyth-solana-receiver");

const RPC_URL = process.env.RPC_URL ?? "https://soo-rpc.zak-a35.workers.dev";
const HERMES = (process.env.HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, "");
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const INTERVAL = Number(process.env.CRANK_INTERVAL_SECS ?? 5) * 1000;
const HEARTBEAT = process.env.HEARTBEAT_FILE ?? `${homedir()}/ladder-crank.beat`;
const HEALTH = process.env.HEALTH_FILE ?? `${homedir()}/ladder-crank.health`;
const FULL = process.env.FULL_VERIFICATION === "1";

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

/** The two ways this keeper writes to the chain, both signed by `payer`. */
export function chainSenders(connection, payer) {
  return {
    sendTx: (tx) => sendAndConfirmTransaction(connection, tx, [payer]),
    /**
     * Post `vaas`, run our instruction against the posted account, close the
     * account. Three transactions on purpose. The receiver's builder batches
     * instructions by byte size, and once our instruction did not fit beside the
     * VAA post it was moved to a transaction of its own, without the heap frame
     * it needs. So the builder only posts; the consume transaction is ours.
     */
    async postAndConsume(vaas, feedHex, makeIxs, units = 200_000) {
      const receiver = new PythSolanaReceiver({ connection, wallet: new Wallet(payer) });
      const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
      if (FULL) await builder.addPostPriceUpdates(vaas);
      else await builder.addPostPartiallyVerifiedPriceUpdates(vaas);
      const priceUpdate = builder.getPriceUpdateAccount(`0x${feedHex}`);
      const posted = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: PRIORITY });
      try {
        await receiver.provider.sendAll(posted, { skipPreflight: false });
        return await sendAndConfirmTransaction(connection, new Transaction().add(...stook.withHeap(makeIxs(priceUpdate), units, PRIORITY)), [payer]);
      } finally {
        // Rent back, whether or not the consume (or part of the post) landed:
        // the price update account and, when fully verified, the encoded VAA the
        // builder collected close instructions for. One per transaction, so a
        // close of an account that never landed fails alone.
        for (const { instruction } of builder.closeInstructions) {
          await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer]).catch((e) => console.error("close update account:", e?.message));
        }
      }
    },
  };
}

// Hermes requests per series per learn pass, and how many round indices one
// search for the next close may look through, from the series' last close
// on (pure arithmetic; only the chosen close costs a request).
export const LEARN_FETCHES = 10;
export const LEARN_SCAN = 4096;

/**
 * The closes a series may be asked to take next, oldest first:
 * `pendingObservations` from its last close, up to `LEARN_SCAN`, and for a
 * series still warming up the one close the program would let it jump to now
 * (`restartTarget`), wherever that is: after a long gap on a short period it
 * lies past any scan from the last close.
 */
export function learnCandidates(sdk, s, now, skippedTo = -1) {
  // Past the last close known unpostable: every close between it and the
  // last close learned is known unpostable too (the first close the program
  // would take is always the earliest, so none was passed over), and starting
  // there keeps a run longer than the scan from hiding what follows it.
  const from = s.lastAt > 0n && skippedTo >= 0 && sdk.closeOf(s, skippedTo) > s.lastAt ? { ...s, lastAt: sdk.closeOf(s, skippedTo) } : s;
  const head = sdk.pendingObservations(from, now, LEARN_SCAN);
  if (s.lastAt <= 0n || sdk.warmedUp(s)) return head;
  const target = sdk.restartTarget(s, now);
  if (head.includes(target)) return head;
  return [...head.filter((i) => i < target), target, ...head.filter((i) => i > target)];
}

/** `--plan` alone, or any of the modes that send; never both. */
export function parseArgs(argv) {
  const args = new Set(argv);
  const mode = { plan: args.has("--plan"), watch: args.has("--watch"), learn: args.has("--learn"), clearUp: args.has("--clear-up") };
  if (mode.plan) {
    const clash = ["--watch", "--learn", "--clear-up"].filter((a) => args.has(a));
    if (clash.length) throw new Error(`--plan sends nothing, so it cannot go with ${clash.join(", ")}`);
  }
  return mode;
}

// The code for "this round still has something to pay out", the one refusal a
// clear-up expects (6035, 0x1793).
const NOT_CLOSABLE = /LadderNotClosable|custom program error: 0x1793\b/;

// A token account the coin's issuer has frozen takes no transfer in: byte 108
// of the account (classic SPL and Token-2022 alike) is its state, 2 frozen.
const frozen = (account) => account?.data?.[108] === 2;

/**
 * The keeper's passes over one chain. `connection` reads and sends, `scanner`
 * serves getProgramAccounts, `hermes(path, feedId)` answers Pyth updates, and
 * every write goes through `sendTx` or `postAndConsume`, which refuse in plan
 * mode. Each of `pass`, `learn` and `clearUp` returns how many of the things
 * it had to do are failing: a step that threw this time, or one still waiting
 * out its backoff after a failure. Waiting on the chain or on Hermes is not a
 * failure.
 */
// Which coin a feed's rounds are for: the anchors, and the devnet stand-ins
// (apps/stook/src/lib/coins.ts), for the Telegram notes.
const FEED_COINS = {
  "2817b784": ["STOOK", "S&P 500"], "be9b59d1": ["ZCAT", "Zcash"], "f68272be": ["KNOTS", "STONK"], "e7d1138d": ["GP", "Gold"],
  "e62df6c8": ["STOOK", "BTC"], "ff61491a": ["ZCAT", "ETH"], "ef0d8b6f": ["KNOTS", "SOL"], "dcef50dd": ["GP", "DOGE"],
};
const SITE = process.env.SITE_URL ?? "https://stookstreet.xyz";

/** A line for Telegram about a round the keeper just moved; null for rounds of
 *  a series shorter than six hours (the hourly test series would say it 48
 *  times a day). A daily round funded late is short too, and still noted. */
export function roundNote(step, pubkey, ladder, parsed, extra = "", periodSecs = 0) {
  if (periodSecs > 0 && periodSecs < 6 * 3600) return null;
  const [coin, on] = FEED_COINS[hex(ladder.feedId).slice(0, 8)] ?? ["A", "its feed"];
  const px = parsed ? Number(parsed.price.price) * 10 ** parsed.price.expo : null;
  const price = px == null ? "" : ` at ${px.toLocaleString("en-US", { maximumFractionDigits: px < 10 ? 4 : 2 })}`;
  const when = new Date(Number(ladder.settlesAt) * 1000).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  const link = `${SITE}/m/${pubkey.toBase58()}`;
  if (step === "open") return `🟢 ${coin} round open: ${on}${price}${extra}. Bell ${when} New York.\n${link}`;
  if (step === "settle") return `🔔 ${coin} round settled: ${on} closed${price}. Winners can collect.\n${link}`;
  return `⚪ ${coin} round voided${extra}. Everyone can take their money back.\n${link}`;
}

export function createKeeper({ connection, scanner, payer, sendTx, postAndConsume, hermes: fetchUpdate = hermes, plan = false, sdk = stook, notify = () => {} }) {
  const stook = sdk;
  const refuse = (what) => { throw new Error(`plan mode sends nothing (${what})`); };
  const send = (tx) => (plan ? refuse("transaction") : sendTx(tx));
  const post = (vaas, feedHex, makeIxs, units) => (plan ? refuse("oracle post") : postAndConsume(vaas, feedHex, makeIxs, units));
  const sendPlain = (ix, units) => send(new Transaction().add(...stook.withHeap([ix], units)));

  // A step the program keeps refusing is not retried every pass: each failure
  // doubles the wait, from 30 s up to ten minutes. A success clears it. A
  // step waiting on Hermes backs off the same way but is not a failure.
  const backoff = new Map();
  const waiting = (key) => (backoff.get(key)?.until ?? 0) > Date.now();
  const failing = (key) => backoff.get(key)?.failing ?? false;
  const failed = (key, isFailure = true) => {
    const n = (backoff.get(key)?.n ?? 0) + 1;
    backoff.set(key, { n, until: Date.now() + Math.min(30_000 * 2 ** (n - 1), 600_000), failing: isFailure });
  };
  const succeeded = (key) => backoff.delete(key);
  // Telegram notes never hold up or fail a pass.
  const tell = (text) => { if (text) Promise.resolve().then(() => notify(text)).catch(() => {}); };
  // The note needs the round's series period; a failed read only costs the note.
  const note = (step, pubkey, ladder, parsed, extra, seriesOf) =>
    Promise.resolve(seriesOf(ladder.series)).then((s) => tell(roundNote(step, pubkey, ladder, parsed, extra, s?.periodSecs ?? 0))).catch(() => {});

  async function pass() {
    const now = BigInt(Math.floor(Date.now() / 1000));
    let failures = 0;
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
      if (plan) { console.log(tag); continue; }
      const key = `${pubkey.toBase58()}:${step}`;
      if (waiting(key)) { if (failing(key)) failures++; continue; }

      try {
        // An open the program would refuse costs a Pyth post and a close for
        // nothing: wait until the series has warmed up and learned the close
        // before this round's opening.
        if (step === "open") {
          const s = await seriesOf(ladder.series);
          const why = s ? stook.openBlocker(s, ladder.opensAt, now, stook.opensLate(ladder, now)) : "series not found";
          if (why) { console.log(tag, "waiting:", why); continue; }
        }
        // Whichever token program owns the mint — classic SPL or Token-2022.
        const mint = await connection.getAccountInfo(ladder.quoteMint);
        if (!mint) { console.log(tag, "quote mint not found"); continue; }
        const refs = { ladder: pubkey, quoteMint: ladder.quoteMint, tokenProgram: mint.owner };
        if (step === "void") {
          console.log(tag, await sendPlain(stook.voidLadderIx(refs, payer.publicKey)));
          succeeded(key);
          note("void", pubkey, ladder, null, ladder.status === "seeding" ? " (it never opened)" : "", seriesOf);
          continue;
        }
        const feed = hex(ladder.feedId);
        // An on-time open and a settle take THE update for their instant (the
        // first at or after it), which Hermes returns for that second. A late
        // open (past the on-time minutes) takes a live one: the first update
        // from a few seconds ago, and the round starts when it lands.
        const late = step === "open" && stook.opensLate(ladder, now);
        const at = step === "open" ? (late ? BigInt(Math.floor(Date.now() / 1000)) - 3n : ladder.opensAt) : ladder.settlesAt;
        const { parsed, vaas } = await fetchUpdate(`/v2/updates/price/${at}`, feed);
        if (!parsed) { console.log(tag, "hermes returned no update yet"); continue; }

        const problem = step === "open" ? stook.openProblem(parsed, ladder, late ? BigInt(Math.floor(Date.now() / 1000)) : undefined) : stook.settlementProblem(parsed, ladder);
        if (problem) {
          // The close's one update cannot settle the round (late, unsure):
          // that update is the proof that voids it, at once.
          if (step === "settle" && stook.voidProof(parsed, ladder)) {
            console.log(tag, "cannot settle (" + problem + "); voiding with proof", await post(vaas, feed, (price) => [stook.voidLadderIx(refs, payer.publicKey, price)]));
            succeeded(key);
            note("void", pubkey, ladder, null, " (Pyth had no clean price at the bell)", seriesOf);
            continue;
          }
          // Otherwise Hermes has not got it yet, or (an open) Pyth was silent
          // at the opening and the round will void when its window passes.
          console.log(tag, "skipped:", problem); continue;
        }

        if (step === "open") {
          console.log(tag, late ? "(late, on a live price)" : "", await post(vaas, feed, (price) => [stook.openLadderIx(refs, payer.publicKey, price, ladder.series)]));
          succeeded(key);
          note("open", pubkey, ladder, parsed, late ? " (opened late, on a live price)" : "", seriesOf);
        } else {
          // The settler is paid in the market's quote token. The token account is
          // made in its own transaction first: adding it beside the settle
          // instruction pushed the Pyth builder to split the transaction, and
          // the settle landed without its heap frame.
          const ata = getAssociatedTokenAddressSync(ladder.quoteMint, payer.publicKey, false, mint.owner);
          if (!(await connection.getAccountInfo(ata))) {
            await send(new Transaction().add(
              createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, ladder.quoteMint, mint.owner)));
          }
          console.log(tag, await post(vaas, feed, (price) => [stook.settleLadderIx(refs, ladder.series, payer.publicKey, price, ata)]));
          succeeded(key);
          note("settle", pubkey, ladder, parsed, "", seriesOf);
        }
      } catch (e) {
        console.error(tag, "failed:", e?.message ?? e);
        failed(key);
        failures++;
      }
    }
    return failures;
  }

  // A finished round keeps its rent and a few base units of dust until it is
  // closed, and it can close only once nothing in it is owed. Winners collect
  // their own; the positions nobody would bother to collect (a miss, a line
  // sold to zero) are swept, rent to their owners; the fee shares are sent to
  // their fixed homes; then the round closes, dust to the treasury, rent to
  // whoever funded it. Every step is permissionless and pays nobody here.
  async function clearUp() {
    if (plan) refuse("clear-up");
    let failures = 0;
    const config = stook.decodeProtocolConfig((await connection.getAccountInfo(stook.deriveProtocolConfig())).data);
    for (const status of ["settled", "void"]) {
      const rounds = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters(status) });
      for (const { pubkey, account } of rounds) {
        const l = stook.decodeLadder(account.data);
        const tag = `${pubkey.toBase58().slice(0, 8)} clear`;
        const key = `${pubkey.toBase58()}:clear`;
        if (waiting(key)) { if (failing(key)) failures++; continue; }
        try {
          const mint = await connection.getAccountInfo(l.quoteMint);
          const refs = { ladder: pubkey, quoteMint: l.quoteMint, tokenProgram: mint.owner };
          // 30 days after the close, anything still uncollected is paid out to
          // its owner's token account, if they have one. The keeper does not
          // open token accounts for others: the owner could close it and keep
          // the rent, so it would be a way to drain the keeper. An owner with no
          // account collects it themselves, whenever they like. Nor to one the
          // issuer has frozen: the payout would fail, and it waits for them.
          const graceOver = BigInt(Math.floor(Date.now() / 1000)) >= l.settlesAt + stook.CLAIM_GRACE_SECS;
          const ownerToken = async (owner) => {
            const ata = getAssociatedTokenAddressSync(l.quoteMint, owner, true, mint.owner);
            const a = await connection.getAccountInfo(ata);
            return a && !frozen(a) ? ata : null;
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
          // A round voided before its close keeps its address until then; the
          // program refuses to close it sooner.
          if (BigInt(Math.floor(Date.now() / 1000)) < l.settlesAt) continue;
          const treasuryToken = getAssociatedTokenAddressSync(l.quoteMint, config.treasury, true, mint.owner);
          const creatorToken = getAssociatedTokenAddressSync(l.quoteMint, l.creator, true, mint.owner);
          // The dust goes to the treasury and the fee shares to it and the
          // creator; a frozen one of those holds the round until it thaws.
          const homes = [treasuryToken, ...(l.feesCreator + l.feesProtocol > 0n ? [creatorToken] : [])];
          if ((await Promise.all(homes.map((k) => connection.getAccountInfo(k)))).some(frozen)) { console.log(tag, "a fee account is frozen; left for now"); continue; }
          await send(new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, treasuryToken, config.treasury, l.quoteMint, mint.owner),
            ...(l.feesCreator + l.feesProtocol > 0n ? [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, creatorToken, l.creator, l.quoteMint, mint.owner)] : [])));
          if (l.feesCreator + l.feesProtocol > 0n) await sendPlain(stook.collectLadderFeesIx(refs, payer.publicKey, creatorToken, treasuryToken));
          console.log(tag, "closed", await sendPlain(stook.closeLadderIx(refs, payer.publicKey, l.creator, treasuryToken)));
          succeeded(key);
        } catch (e) {
          // A round with something still to pay out cannot close yet; it is
          // tried again next time, and is not a failure of the keeper's.
          if (NOT_CLOSABLE.test(`${e?.message ?? e} ${(e?.logs ?? []).join(" ")}`)) { console.log(tag, "not closable yet"); continue; }
          console.error(tag, "failed:", e?.message ?? e);
          failed(key);
          failures++;
        }
      }
    }
    return failures;
  }

  // Every series learns from every day's close, whether or not a round ran:
  // for each close it has not seen, fetch the Pyth update that is the price at
  // that second (Hermes keeps history) and submit it. The program checks it
  // against the settlement rule, so what is submitted is not a choice. A close
  // whose update can never be posted is remembered and passed over where the
  // program allows it. A new series backfills its first closes from history,
  // so it can take rounds as soon as it has twenty.
  const unobservable = new Set();
  const skippedTo = new Map(); // series → the latest close known unpostable
  async function learn() {
    if (plan) refuse("learn");
    let failures = 0;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const all = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: [
      { dataSize: stook.SERIES_SIZE },
      { memcmp: { offset: 0, bytes: bs58(stook.SERIES_DISCRIMINATOR) } },
    ] });
    for (const { pubkey, account } of all) {
      let s = stook.decodeSeries(account.data);
      const feed = hex(s.feedId);
      const name = pubkey.toBase58();
      // Each post is the first close, in order, that the program would take
      // now (`mayObserve`, on the series as it stands) and that is not known
      // to be unpostable. Closes known unpostable cost nothing to pass over,
      // nor do those the program would refuse (a jump over a close younger
      // than a week, or one a series still warming up may not start from),
      // so the search reaches a permitted close however many come first.
      // Hermes is asked at most `LEARN_FETCHES` times per series per pass.
      for (let fetches = 0; ; ) {
        const pending = learnCandidates(stook, s, now, skippedTo.get(name) ?? -1);
        const index = pending.find((i) => !unobservable.has(`${name}:${i}`) && stook.mayObserve(s, i, now));
        if (index === undefined) {
          // Nothing the program would take yet: waiting (a week to pass, the
          // backfill window to reach), not failing.
          if (pending.some((i) => !unobservable.has(`${name}:${i}`))) console.log(name.slice(0, 8), "waiting: no pending close may be taken yet");
          break;
        }
        const key = `${name}:${index}`;
        if (waiting(key)) { if (failing(key)) failures++; break; }
        if (fetches++ >= LEARN_FETCHES) break;
        const at = stook.closeOf(s, index);
        const tag = `${name.slice(0, 8)} observe ${new Date(Number(at) * 1000).toISOString()}`;
        try {
          const { parsed, vaas } = await fetchUpdate(`/v2/updates/price/${at}`, feed);
          // Hermes answering without the update, or without its predecessor's
          // time, is a glitch to retry, not a close to give up on.
          if (!parsed?.metadata?.prev_publish_time || !(BigInt(parsed.metadata.prev_publish_time) < at && at <= BigInt(parsed.price.publish_time))) {
            console.log(tag, "hermes has no usable update yet; retrying later"); failed(key, false); break;
          }
          // An RPC node that has not seen the blockhash yet refuses the
          // simulation; that clears in seconds, so try again at once.
          for (let attempt = 0; ; attempt++) {
            try {
              // A weekday-clock series still warming up counts trading days
              // back on chain (anchoring, restarting): some 300-410k units.
              const units = s.clock === stook.CLOCK_NEW_YORK_WEEKDAYS && !stook.warmedUp(s) ? 600_000 : 200_000;
              console.log(tag, await post(vaas, feed, (price) => [stook.observeSeriesIx(pubkey, payer.publicKey, price, index)], units));
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
          // all. Remember those for good and search on; retry anything else
          // next pass, in order.
          if (/GuardianSetExpired|OracleWrongFeed|SeriesAlreadyObserved/.test(why)) {
            unobservable.add(key);
            if (index > (skippedTo.get(name) ?? -1)) skippedTo.set(name, index);
            console.log(tag, "skipped for good:", (why.match(/Error Code: (\w+)/) ?? [])[1] ?? "unverifiable");
            const fresh = await connection.getAccountInfo(pubkey);
            if (fresh) s = stook.decodeSeries(fresh.data);
            continue;
          }
          console.error(tag, "failed:", e?.message ?? e);
          failed(key);
          failures++;
          break;
        }
        // The next close is chosen from the series as the program left it. A
        // read that does not show this close taken yet ends the series' turn,
        // rather than fetch the same close again.
        const fresh = await connection.getAccountInfo(pubkey);
        const next = fresh ? stook.decodeSeries(fresh.data) : null;
        if (!next || next.lastAt !== at) break;
        s = next;
      }
    }
    return failures;
  }

  return { pass, learn, clearUp };
}

/**
 * Pass every `interval` ms, learning every fourth pass and clearing up every
 * tenth. Two signals for the box's watchdog:
 *  - `beat()` after every pass that ran: the keeper is alive and can read the
 *    chain. A process can stay up with every request dead, as on 2026-09-25;
 *    then passes throw, the beat goes stale and the watchdog restarts it.
 *  - `healthy()` after a pass with nothing failing: the pass itself and the
 *    last learn (its count stands until it runs again). Reads can work while
 *    every send fails; then the beat stays fresh and this goes stale. A
 *    restart rarely cures that (a round the program keeps refusing stays
 *    refused), so the watchdog logs it and restarts at most once an hour.
 * Clear-up is logged, not counted: one finished round that cannot be cleared
 * (an account frozen by the coin's issuer, say) says nothing of the rounds
 * being opened and settled.
 */
export async function watch(keeper, { interval, beat, healthy = () => {}, passes = Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let learning = 0, last = 0;
  for (let n = 0; n < passes; n++) {
    // Learn first, so a round opening at yesterday's close opens on a
    // series that has already counted it.
    if (n % 4 === 0) learning = await keeper.learn().catch((e) => { console.error("learn failed:", e?.message ?? e); return 1; });
    let ran = true;
    const passing = await keeper.pass().catch((e) => { console.error(new Date().toISOString(), "pass failed:", e?.message ?? e); ran = false; return 1; });
    if (ran) { try { beat(); } catch {} }
    const failing = passing + learning;
    if (failing === 0) { try { healthy(); } catch {} }
    else if (failing !== last) console.error(new Date().toISOString(), `${failing} step(s) failing`);
    last = failing;
    // finished rounds are not urgent: every ten passes
    if (n % 10 === 0) {
      const clearing = await keeper.clearUp().catch((e) => { console.error("clear-up failed:", e?.message ?? e); return 1; });
      if (clearing) console.error(new Date().toISOString(), `clear-up: ${clearing} round(s) failing`);
    }
    if (n + 1 < passes) await sleep(interval);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let mode;
  try { mode = parseArgs(argv); } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  // Reads and sends go through RPC_URL; confirmations subscribe over a
  // websocket, which an HTTP proxy cannot carry, so that stays on the public
  // endpoint.
  const connection = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: process.env.WS_URL ?? "wss://api.devnet.solana.com/" });
  // Scanning for markets needs getProgramAccounts, which keyed free tiers refuse;
  // the public endpoint serves it fine at one scan per pass.
  const scanner = new Connection(process.env.SCAN_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
  // Round notes to Telegram when the box has keys (~/stook-alerts.env).
  const { TG_BOT_TOKEN: tg, TG_CHAT_ID: chat } = process.env;
  // Each note also goes, time-stamped, to EVENTS_FILE, which the box's daily
  // report counts.
  const events = process.env.EVENTS_FILE ?? `${homedir()}/stook-events.log`;
  const notify = mode.plan ? undefined : async (text) => {
    try { appendFileSync(events, `${new Date().toISOString()} ${text.split("\n")[0]}\n`); } catch {}
    if (tg && chat) await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
  };
  const keeper = createKeeper({ connection, scanner, payer, plan: mode.plan, notify, ...chainSenders(connection, payer) });

  if (mode.watch) {
    await watch(keeper, { interval: INTERVAL, beat: () => writeFileSync(HEARTBEAT, String(Date.now())), healthy: () => writeFileSync(HEALTH, String(Date.now())) });
  } else {
    if (mode.learn) await keeper.learn();
    await keeper.pass();
    if (mode.clearUp) await keeper.clearUp();
  }
}

const entry = process.argv[1] ? (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; } })() : null;
if (entry === import.meta.url) await main();

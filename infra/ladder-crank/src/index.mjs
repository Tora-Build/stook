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
import { Wallet } from "@coral-xyz/anchor";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

// The receiver's ESM build imports `jito-ts/dist/sdk/block-engine/types`
// without an extension, which Node's ESM loader refuses. Its CJS build is fine.
const { PythSolanaReceiver } = createRequire(import.meta.url)("@pythnetwork/pyth-solana-receiver");

const args = new Set(process.argv.slice(2));
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const HERMES = (process.env.HERMES_URL ?? "https://hermes.pyth.network").replace(/\/$/, "");
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const INTERVAL = Number(process.env.CRANK_INTERVAL_SECS ?? 5) * 1000;
const FULL = process.env.FULL_VERIFICATION === "1";

const connection = new Connection(RPC_URL, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
const hex = (b) => Buffer.from(b).toString("hex");

async function hermes(path, feedId) {
  if (!process.env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not set; Hermes answers 401 without it");
  const res = await fetch(`${HERMES}${path}?ids%5B%5D=${feedId}&encoding=base64`, {
    headers: { authorization: `Bearer ${process.env.PYTH_API_KEY}` },
  });
  if (!res.ok) throw new Error(`hermes ${path}: ${res.status}`);
  const body = await res.json();
  return { parsed: body.parsed?.[0], vaas: body.binary?.data ?? [] };
}

/** Post `vaas`, run `ix` against the posted account, close the account. */
async function postAndConsume(vaas, feedHex, makeIxs) {
  const receiver = new PythSolanaReceiver({ connection, wallet: new Wallet(payer) });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  if (FULL) await builder.addPostPriceUpdates(vaas);
  else await builder.addPostPartiallyVerifiedPriceUpdates(vaas);
  // The builder keys posted accounts by "0x"-prefixed feed id.
  await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => [
    // sooth_core's allocator assumes a 256 KB heap on every transaction.
    { instruction: ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }), signers: [] },
    ...makeIxs(getPriceUpdateAccount(`0x${feedHex}`)).map((instruction) => ({ instruction, signers: [] })),
  ]);
  const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 });
  return receiver.provider.sendAll(txs, { skipPreflight: false });
}

async function sendPlain(ix) {
  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  return sendAndConfirmTransaction(connection, new Transaction().add(...stook.withHeap([ix])), [payer]);
}

async function pass() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const found = [];
  for (const status of ["seeding", "open"]) {
    const accounts = await connection.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters(status) });
    for (const a of accounts) found.push({ pubkey: a.pubkey, ladder: stook.decodeLadder(a.account.data) });
  }

  for (const { pubkey, ladder } of found) {
    const step = stook.nextStep(ladder, now);
    if (!step) continue;
    const tag = `${pubkey.toBase58().slice(0, 8)} ${step}`;
    if (args.has("--plan")) { console.log(tag); continue; }

    try {
      // Whichever token program owns the mint — classic SPL or Token-2022.
      const mint = await connection.getAccountInfo(ladder.quoteMint);
      if (!mint) { console.log(tag, "quote mint not found"); continue; }
      const refs = { ladder: pubkey, quoteMint: ladder.quoteMint, tokenProgram: mint.owner };
      if (step === "void") {
        console.log(tag, await sendPlain(stook.voidLadderIx(refs, payer.publicKey)));
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
        console.log(tag, await postAndConsume(vaas, feed, (price) => [stook.openLadderIx(refs, payer.publicKey, price)]));
      } else {
        // The settler is paid in the market's quote token; make sure we can receive it.
        const ata = getAssociatedTokenAddressSync(ladder.quoteMint, payer.publicKey, false, mint.owner);
        console.log(tag, await postAndConsume(vaas, feed, (price) => [
          createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, ladder.quoteMint, mint.owner),
          stook.settleLadderIx(refs, payer.publicKey, price, ata),
        ]));
      }
    } catch (e) {
      console.error(tag, "failed:", e?.message ?? e);
    }
  }
}

if (args.has("--watch")) {
  for (;;) { await pass().catch((e) => console.error("pass failed:", e?.message ?? e)); await new Promise((r) => setTimeout(r, INTERVAL)); }
} else {
  await pass();
}

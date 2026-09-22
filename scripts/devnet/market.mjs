#!/usr/bin/env node
// Devnet market operations from the CLI wallet.
//
//   node market.mjs create BTC [--opens-in 120] [--trades-for 3600] [--seed 2000] [--tier 2]
//   node market.mjs open <ladder>      open from Pyth's push-oracle account, once it is fresh
//   node market.mjs list

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

const FEEDS = {
  NVDA: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};
const PUSH = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const env = readFileSync(new URL("../../apps/stook/.env.local", import.meta.url), "utf8");
const QUOTE = new PublicKey(env.match(/^VITE_QUOTE_MINT=(\S+)/m)[1]);
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? Number(rest[i + 1]) : dflt; };
const send = (ixs, signers = [payer]) => sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap(ixs)), signers);
const hex = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

if (cmd === "create") {
  const sym = rest[0]?.toUpperCase();
  const feed = FEEDS[sym] ?? (/^[0-9a-f]{64}$/i.test(sym ?? "") ? sym.toLowerCase() : null);
  if (!feed) throw new Error(`unknown asset ${sym}; one of ${Object.keys(FEEDS).join(", ")} or a feed id`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const opensAt = now + BigInt(flag("opens-in", 120)), locksAt = opensAt + BigInt(flag("trades-for", 3600)), settlesAt = locksAt + 120n;
  const key = { feedId: hex(feed), settlesAt, quoteMint: QUOTE, tier: flag("tier", 2) };
  const sig = await send([stook.createLadderIx({
    ...key, creator: payer.publicKey, creatorToken: getAssociatedTokenAddressSync(QUOTE, payer.publicKey, false, TOKEN_PROGRAM_ID),
    tokenProgram: TOKEN_PROGRAM_ID, opensAt, locksAt, seed: BigInt(flag("seed", 2000)) * 1_000_000n, feeBps: 100,
  })]);
  console.log("created", stook.deriveLadderPda(key).toBase58(), "opens", new Date(Number(opensAt) * 1000).toISOString(), "settles", new Date(Number(settlesAt) * 1000).toISOString(), sig);
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
    const refs = { ladder: ladderKey, quoteMint: l.quoteMint, tokenProgram: TOKEN_PROGRAM_ID };
    try {
      console.log("opened", await send([stook.openLadderIx(refs, payer.publicKey, pda)]));
      break;
    } catch (e) { console.log("open failed:", e.message.slice(0, 200)); await new Promise((r) => setTimeout(r, 5000)); }
  }
} else if (cmd === "list") {
  const accounts = await c.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters() });
  for (const a of accounts) {
    const l = stook.decodeLadder(a.account.data);
    console.log(a.pubkey.toBase58(), l.status, "settles", new Date(Number(l.settlesAt) * 1000).toISOString(), "deposits", l.depositTotal, "trades", l.curveSeq);
  }
} else {
  console.log("usage: market.mjs create <SYM> | open <ladder> | list");
}

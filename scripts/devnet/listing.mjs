// The anchors a coin may be listed on, and the listing fee (protocol authority).
//
//   node listing.mjs show            the anchors on the list, the fee, and every listing
//   node listing.mjs set             put this network's anchors on the list and set the fee
//   node listing.mjs reject <house>  turn a listing down before it goes live
//
// Anchors: feeds Pyth keeps live on chain for free on this network (devnet:
// SOL, BTC, ETH; mainnet: ZEC, SOL, BTC, ETH, gold), each closing 4 PM New
// York like the street's own coins.
//
// ENV: RPC_URL (default public devnet), KEYPAIR (default ~/.config/solana/id.json),
//      NETWORK=mainnet for mainnet's anchors, LIST_FEE_SOL (default 0.1)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";

const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", { commitment: "confirmed", wsEndpoint: process.env.WS_URL });
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const FEEDS = {
  ZEC: "be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  XAU: "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
};
const ANCHORS = process.env.NETWORK === "mainnet"
  ? [["ZEC", stook.CLOCK_NEW_YORK], ["SOL", stook.CLOCK_NEW_YORK], ["BTC", stook.CLOCK_NEW_YORK], ["ETH", stook.CLOCK_NEW_YORK], ["XAU", stook.CLOCK_NEW_YORK_WEEKDAYS]]
  : [["SOL", stook.CLOCK_NEW_YORK], ["BTC", stook.CLOCK_NEW_YORK], ["ETH", stook.CLOCK_NEW_YORK]];
const hexBytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const name = (bytes) => Object.entries(FEEDS).find(([, h]) => h === Buffer.from(bytes).toString("hex"))?.[0] ?? Buffer.from(bytes).toString("hex").slice(0, 8);
const send = (ix) => sendAndConfirmTransaction(c, new Transaction().add(...stook.withHeap([ix])), [payer]);

const [cmd = "show", arg] = process.argv.slice(2);
if (cmd === "set") {
  for (const [sym, clock] of ANCHORS) {
    console.log(sym, await send(stook.listAnchorSetIx({ authority: payer.publicKey, feedId: hexBytes(FEEDS[sym]), clock, closeSecs: 16 * 3600, active: true })));
  }
  const lamports = BigInt(Math.round(Number(process.env.LIST_FEE_SOL ?? "0.1") * 1e9));
  console.log("fee", await send(stook.listFeeSetIx(payer.publicKey, lamports)));
} else if (cmd === "reject") {
  console.log(await send(stook.coinRejectIx(payer.publicKey, new PublicKey(arg))));
}

const config = stook.decodeProtocolConfig((await c.getAccountInfo(stook.deriveProtocolConfig())).data);
console.log(`listing fee ${Number(config.listFeeLamports) / 1e9} SOL`);
for (const a of await c.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.listAnchorFilters() })) {
  const x = stook.decodeListAnchor(a.account.data);
  console.log(`anchor ${name(x.feedId).padEnd(4)} ${x.active ? "on" : "off"} · clock ${x.clock} · closes ${x.closeSecs / 3600}:00`);
}
for (const a of await c.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.houseFilters() })) {
  const h = stook.decodeHouse(a.account.data);
  if (h.opensAfter === 0n) continue;
  console.log(`listing ${a.pubkey.toBase58()} mint ${h.quoteMint.toBase58()} ${h.opensAfter === stook.HOUSE_REJECTED ? "turned down" : `live from ${new Date(Number(h.opensAfter) * 1000).toISOString()}`}`);
}

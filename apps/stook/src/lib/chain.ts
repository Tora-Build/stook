// Reads and writes against the program. Every write goes through the wallet
// adapter with the heap frame prepended (`stook.withHeap`).

import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { AccountLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { PYTH_PUSH_ORACLE, SCAN_RPC_URL } from "./config";

export interface LadderRow { pubkey: PublicKey; ladder: stook.LadderAccount }

// Account scans go to the public endpoint: keyed free tiers refuse
// getProgramAccounts, and the public one copes with a scan every few seconds.
const scanner = new Connection(SCAN_RPC_URL, "confirmed");

export async function fetchLadders(_c: Connection): Promise<LadderRow[]> {
  const accounts = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters() });
  return accounts.map((a) => ({ pubkey: a.pubkey, ladder: stook.decodeLadder(a.account.data) }));
}

export async function fetchLadder(c: Connection, pubkey: PublicKey): Promise<stook.LadderAccount | null> {
  const a = await c.getAccountInfo(pubkey);
  return a ? stook.decodeLadder(a.data) : null;
}

export async function fetchSeries(c: Connection, key: PublicKey): Promise<stook.SeriesAccount | null> {
  const a = await c.getAccountInfo(key);
  return a ? stook.decodeSeries(a.data) : null;
}

/** The rounds at these addresses, by address; absent ones are simply missing. */
export async function fetchLaddersAt(c: Connection, keys: PublicKey[]): Promise<Map<string, stook.LadderAccount>> {
  const out = new Map<string, stook.LadderAccount>();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const infos = await c.getMultipleAccountsInfo(chunk);
    infos.forEach((a, n) => { if (a && a.data.length === stook.LADDER_SIZE) out.set(chunk[n]!.toBase58(), stook.decodeLadder(a.data)); });
  }
  return out;
}

export interface PositionRow { pubkey: PublicKey; position: stook.LadderPositionAccount }
export async function fetchPositions(_c: Connection, ladder: PublicKey, owner: PublicKey): Promise<PositionRow[]> {
  const accounts = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: base58(stook.POSITION_DISCRIMINATOR) } },
      { memcmp: { offset: 8, bytes: ladder.toBase58() } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ],
  });
  return accounts.map((a) => ({ pubkey: a.pubkey, position: stook.decodeLadderPosition(a.account.data) }));
}

export interface TrancheRow { pubkey: PublicKey; tranche: stook.LadderTrancheAccount }
export async function fetchTranches(_c: Connection, ladder: PublicKey, owner?: PublicKey): Promise<TrancheRow[]> {
  const filters = [
    { memcmp: { offset: 0, bytes: base58(stook.TRANCHE_DISCRIMINATOR) } },
    { memcmp: { offset: 16, bytes: ladder.toBase58() } },
  ];
  if (owner) filters.push({ memcmp: { offset: 48, bytes: owner.toBase58() } });
  const accounts = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters });
  return accounts.map((a) => ({ pubkey: a.pubkey, tranche: stook.decodeLadderTranche(a.account.data) }));
}

/** One round a wallet is in: its lines and its deposits there. */
export interface Holding { pubkey: PublicKey; ladder: stook.LadderAccount; positions: PositionRow[]; tranches: TrancheRow[] }

/**
 * Everything `owner` holds, in every round: two scans (positions and
 * deposits by owner), then the rounds they are in. Rounds in a layout this
 * program no longer reads are left out.
 */
export async function fetchHoldings(c: Connection, owner: PublicKey): Promise<Holding[]> {
  const [pos, trs] = await Promise.all([
    scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: [
      { memcmp: { offset: 0, bytes: base58(stook.POSITION_DISCRIMINATOR) } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ] }),
    scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: [
      { dataSize: stook.TRANCHE_SIZE },
      { memcmp: { offset: 0, bytes: base58(stook.TRANCHE_DISCRIMINATOR) } },
      { memcmp: { offset: 48, bytes: owner.toBase58() } },
    ] }),
  ]);
  const by = new Map<string, { positions: PositionRow[]; tranches: TrancheRow[] }>();
  const slot = (k: PublicKey) => { const key = k.toBase58(); if (!by.has(key)) by.set(key, { positions: [], tranches: [] }); return by.get(key)!; };
  for (const a of pos) { const p = stook.decodeLadderPosition(a.account.data); slot(p.ladder).positions.push({ pubkey: a.pubkey, position: p }); }
  for (const a of trs) { const t = stook.decodeLadderTranche(a.account.data); slot(t.ladder).tranches.push({ pubkey: a.pubkey, tranche: t }); }
  const keys = [...by.keys()].map((k) => new PublicKey(k));
  const ladders = await fetchLaddersAt(c, keys);
  return keys.filter((k) => ladders.has(k.toBase58())).map((k) => ({ pubkey: k, ladder: ladders.get(k.toBase58())!, ...by.get(k.toBase58())! }));
}

export interface MintInfo { decimals: number; tokenProgram: PublicKey; report: stook.MintReport }
export async function fetchMint(c: Connection, mint: PublicKey): Promise<MintInfo | null> {
  const a = await c.getAccountInfo(mint);
  if (!a) return null;
  const report = stook.classifyMint(new Uint8Array(a.data));
  return { decimals: report.decimals, tokenProgram: a.owner, report };
}

export async function fetchTokenBalance(c: Connection, mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const a = await c.getAccountInfo(ata);
  if (!a) return 0n;
  return AccountLayout.decode(a.data.subarray(0, AccountLayout.span)).amount;
}

export const ataOf = (mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);

/** Makes the wallet's token account for `mint` if it does not exist yet; a no-op otherwise. */
export const ensureAta = (mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): TransactionInstruction =>
  createAssociatedTokenAccountIdempotentInstruction(owner, ataOf(mint, owner, tokenProgram), owner, mint, tokenProgram);

/** The live Pyth price for a feed, from the push oracle's devnet account. */
export interface LivePrice { price: bigint; expo: number; publishTime: number; conf: bigint }
export async function fetchLivePrice(c: Connection, feedId: Uint8Array): Promise<LivePrice | null> {
  const [pda] = PublicKey.findProgramAddressSync([Uint8Array.of(0, 0), feedId], PYTH_PUSH_ORACLE);
  const a = await c.getAccountInfo(pda);
  if (!a) return null;
  const d = Buffer.from(a.data);
  // PriceUpdateV2: disc 8, write_authority 32, verification 1(+8 if partial? no: enum tag 1, then u8 for Partial) — locate the feed id instead.
  const at = d.indexOf(Buffer.from(feedId));
  if (at < 0) return null;
  return { price: d.readBigInt64LE(at + 32), conf: d.readBigUInt64LE(at + 40), expo: d.readInt32LE(at + 48), publishTime: Number(d.readBigInt64LE(at + 52)) };
}

export async function send(c: Connection, wallet: WalletContextState, ixs: TransactionInstruction[], computeUnits = 120_000, extraSigners: Keypair[] = []): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("connect a wallet first");
  // The wallet only signs. Broadcasting and confirming are done here: the
  // signed bytes are re-sent every two seconds until the network confirms
  // them or the blockhash dies — devnet drops transactions freely, and a
  // single send with a websocket wait is what produced "expired" for users.
  // If the blockhash does die, the transaction is rebuilt and signed again.
  for (let attempt = 0; ; attempt++) {
    const tx = new Transaction().add(...stook.withHeap(ixs, computeUnits, 50_000));
    tx.feePayer = wallet.publicKey;
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    if (extraSigners.length) tx.partialSign(...extraSigners);
    const signed = await wallet.signTransaction(tx);
    const raw = signed.serialize();
    const sig = await c.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
    // Read the block height BEFORE the status, so a transaction included in
    // the last valid block is seen as landed rather than declared expired.
    const landed = async () => {
      const st = (await c.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (st?.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
      return !!st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized");
    };
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const dead = (await c.getBlockHeight("confirmed")) > lastValidBlockHeight;
      if (await landed()) return sig;
      if (dead) break;
      await c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    // Before signing again, look once more: a node that answered late must
    // not turn one buy into two.
    await new Promise((r) => setTimeout(r, 2000));
    if (await landed()) return sig;
    if (attempt >= 1) throw new Error("The network did not include the transaction in time, twice. Try again in a moment.");
  }
}

/** Turn a program error in a simulation log into the message a person can act on. */
export function explain(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i);
  const logs = (e as { logs?: string[] })?.logs?.join("\n") ?? "";
  const named = (logs + text).match(/Error Code: (\w+)/);
  const code = named?.[1] ?? (m ? `0x${m[1]}` : null);
  const known: Record<string, string> = {
    SlippageExceeded: "The price moved past your limit. Quote again.",
    LadderCurveMoved: "A trade landed while you were looking. Refresh the quote and try again.",
    LadderNotOpen: "The market is not open for trading.",
    LadderNotJoinable: "The market no longer takes liquidity.",
    LadderInsufficientShares: "You hold fewer shares than that.",
    LadderSeedTooSmall: "Deposit at least one whole token.",
    MintNeedsApproval: "This token's issuer has powers over holders; the protocol must approve the mint before it can quote a market.",
    UnsupportedMintExtension: "This token cannot be held in a market vault.",
    ProtocolPaused: "The protocol is paused.",
    LadderNotFinal: "The market has not settled yet.",
    LadderBadTimes: "Too close to its close to fund this day, or more than 31 days ahead.",
    LadderNotVoidable: "This round can still finish; it cannot be voided yet.",
    LadderStillSettleable: "The closing price can still settle this round, so it cannot be voided.",
    SeriesInactive: "This coin is not starting new rounds right now.",
    LadderTooDeep: "That deposit is larger than one round can take.",
    AccountNotInitialized: "An account this needs does not exist yet, usually a token account with none of the coin in it. Use test coins in the header first.",
  };
  if (code && known[code]) return known[code]!;
  // The token program's own errors: 0x1 is "insufficient funds".
  if (/Token(z|kegQ)[A-Za-z0-9]* failed: custom program error: 0x1\b/.test(logs + text) || (m?.[1] === "1" && /Token/.test(logs + text))) return "Not enough of the coin in your wallet for that. On devnet, use test coins in the header.";
  if (m?.[1] === "1") return "Not enough of the coin in your wallet for that.";
  if (text.includes("User rejected")) return "Signature declined.";
  return code ? `Program refused: ${code}` : text.slice(0, 200);
}

export const TOKEN_PROGRAMS = { classic: TOKEN_PROGRAM_ID, token2022: TOKEN_2022_PROGRAM_ID };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = ""; for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

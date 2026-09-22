import { PublicKey } from "@solana/web3.js";

const env = import.meta.env;

// Devnet through a keyed proxy (an Alchemy endpoint behind a Worker); the public
// endpoint rate-limits a browser after a few reads.
export const RPC_URL: string = env.VITE_RPC_URL || "https://soo-rpc.zak-a35.workers.dev";
/** Confirmations subscribe over a websocket the HTTP proxy cannot carry. */
export const WS_URL: string = env.VITE_WS_URL || "wss://api.devnet.solana.com/";
/** For getProgramAccounts only; see lib/chain. */
export const SCAN_RPC_URL: string = env.VITE_SCAN_RPC_URL || "https://api.devnet.solana.com";
export const QUOTE_MINT: PublicKey | null = env.VITE_QUOTE_MINT ? new PublicKey(env.VITE_QUOTE_MINT) : null;
export const FAUCET_AUTHORITY_BYTES: string = env.VITE_FAUCET_AUTHORITY_BYTES || "";
export const EXPLORER = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

/** Pyth's push oracle: one `PriceUpdateV2` per feed, refreshed by Pyth's own keeper. */
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

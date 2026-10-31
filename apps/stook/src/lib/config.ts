import { PublicKey } from "@solana/web3.js";

const env = import.meta.env;

/** The cluster: VITE_CLUSTER, else devnet when the build carries devnet mints. */
export const CLUSTER: "devnet" | "mainnet-beta" = env.VITE_CLUSTER === "devnet" || (!env.VITE_CLUSTER && env.VITE_DEVNET_MINTS) ? "devnet" : "mainnet-beta";
const PUBLIC_RPC = `https://api.${CLUSTER}.solana.com`;
// On devnet the default is a keyed proxy (an Alchemy endpoint behind a Worker);
// the public endpoint rate-limits a browser after a few reads. Mainnet sets its own.
export const RPC_URL: string = env.VITE_RPC_URL || (CLUSTER === "devnet" ? "https://soo-rpc.zak-a35.workers.dev" : PUBLIC_RPC);
/** Confirmations subscribe over a websocket the HTTP proxy cannot carry. */
export const WS_URL: string = env.VITE_WS_URL || `wss://api.${CLUSTER}.solana.com/`;
/** For getProgramAccounts only; see lib/chain. */
export const SCAN_RPC_URL: string = env.VITE_SCAN_RPC_URL || PUBLIC_RPC;
export const QUOTE_MINT: PublicKey | null = env.VITE_QUOTE_MINT ? new PublicKey(env.VITE_QUOTE_MINT) : null;
/** The test-coin faucet's mint authority. Empty (always on mainnet) hides every test-coin hint. */
export const FAUCET_AUTHORITY_BYTES: string = CLUSTER === "devnet" ? env.VITE_FAUCET_AUTHORITY_BYTES || "" : "";
export const EXPLORER = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`;

/** Pyth's push oracle: one `PriceUpdateV2` per feed, refreshed by Pyth's own keeper. */
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

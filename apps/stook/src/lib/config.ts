import { PublicKey } from "@solana/web3.js";

const env = import.meta.env;

export const RPC_URL: string = env.VITE_RPC_URL || "https://api.devnet.solana.com";
export const QUOTE_MINT: PublicKey | null = env.VITE_QUOTE_MINT ? new PublicKey(env.VITE_QUOTE_MINT) : null;
export const FAUCET_AUTHORITY_BYTES: string = env.VITE_FAUCET_AUTHORITY_BYTES || "";
export const EXPLORER = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

/** Pyth's push oracle: one `PriceUpdateV2` per feed, refreshed by Pyth's own keeper. */
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

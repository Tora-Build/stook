import { PublicKey } from "@solana/web3.js";

/** `sooth_core` as Stook deploys it (devnet and localnet). */
export const SOOTH_CORE_PROGRAM_ID = new PublicKey("55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353");

/** Every transaction must request this heap; see the program's allocator. */
export const SOOTH_CORE_HEAP_LEN = 256 * 1024;

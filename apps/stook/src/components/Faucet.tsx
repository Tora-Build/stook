// Devnet only: mints the mock quote token to the connected wallet. The mint
// authority ships in the bundle on purpose — the token is worthless and the
// faucet exists to hand it out.
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { Keypair, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { FAUCET_AUTHORITY_BYTES, QUOTE_MINT } from "../lib/config";
import { useToast } from "./Toast";
import { explain } from "../lib/chain";

export function Faucet() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const owner = wallet.publicKey, quote = QUOTE_MINT;
  if (!FAUCET_AUTHORITY_BYTES || !quote || !owner) return null;

  const mint = async () => {
    setBusy(true);
    try {
      const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(FAUCET_AUTHORITY_BYTES)));
      const ata = getAssociatedTokenAddressSync(quote, owner, false, TOKEN_PROGRAM_ID);
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, quote, TOKEN_PROGRAM_ID),
        createMintToInstruction(quote, ata, authority.publicKey, 10_000_000_000n, [], TOKEN_PROGRAM_ID),
      );
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.partialSign(authority);
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      toast.ok("10,000 test USDC minted", sig);
      void qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e) { toast.err(explain(e)); } finally { setBusy(false); }
  };
  return <button className="small" onClick={mint} disabled={busy}>{busy ? "Minting…" : "Get test USDC"}</button>;
}

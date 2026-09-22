// Devnet only: hands the connected wallet the mock USDC and every street
// coin's devnet twin, in one transaction. The mint authority ships in the
// bundle on purpose — the tokens are worthless and handing them out is the
// faucet's job.
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { Keypair, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { FAUCET_AUTHORITY_BYTES, QUOTE_MINT } from "../lib/config";
import { COINS, mintOf } from "../lib/coins";
import { useToast } from "./Toast";
import { explain } from "../lib/chain";

export function Faucet() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const owner = wallet.publicKey;
  if (!FAUCET_AUTHORITY_BYTES || !owner) return null;

  const mint = async () => {
    setBusy(true);
    try {
      const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(FAUCET_AUTHORITY_BYTES)));
      const tx = new Transaction();
      const give = (m: typeof QUOTE_MINT, program: typeof TOKEN_PROGRAM_ID, amount: bigint) => {
        if (!m) return;
        const ata = getAssociatedTokenAddressSync(m, owner, false, program);
        tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, m, program), createMintToInstruction(m, ata, authority.publicKey, amount, [], program));
      };
      give(QUOTE_MINT, TOKEN_PROGRAM_ID, 10_000_000_000n);
      for (const c of COINS) { const m = mintOf(c); if (m && m.toBase58() !== c.mint) give(m, TOKEN_2022_PROGRAM_ID, 10_000n * 10n ** BigInt(c.decimals)); }
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.partialSign(authority);
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      toast.ok("10,000 of each street coin, and test USDC, minted", sig);
      void qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e) { toast.err(explain(e)); } finally { setBusy(false); }
  };
  return <button className="small" onClick={mint} disabled={busy}>{busy ? "Minting…" : "Get test coins"}</button>;
}

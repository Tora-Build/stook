// Devnet only: hands the connected wallet the mock USDC and every street
// coin's devnet twin, in one transaction. The mint authority ships in the
// bundle on purpose — the tokens are worthless and handing them out is the
// faucet's job.
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { Keypair, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { FAUCET_AUTHORITY_BYTES, QUOTE_MINT } from "../lib/config";
import { COINS, mintOf } from "../lib/coins";
import { useToast } from "./Toast";
import { explain, send } from "../lib/chain";

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
      const ixs: TransactionInstruction[] = [];
      const give = (m: typeof QUOTE_MINT, program: typeof TOKEN_PROGRAM_ID, amount: bigint) => {
        if (!m) return;
        const ata = getAssociatedTokenAddressSync(m, owner, false, program);
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, m, program), createMintToInstruction(m, ata, authority.publicKey, amount, [], program));
      };
      give(QUOTE_MINT, TOKEN_PROGRAM_ID, 10_000_000_000n);
      for (const c of COINS) { const m = mintOf(c); if (m && m.toBase58() !== c.mint) give(m, TOKEN_2022_PROGRAM_ID, 10_000n * 10n ** BigInt(c.decimals)); }
      // Same sender as every other transaction: sign, broadcast, rebroadcast until confirmed.
      const sig = await send(connection, wallet, ixs, 200_000, [authority]);
      toast.ok("10,000 of each street coin, and test USDC, minted", sig);
      void qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (e) { toast.err(explain(e)); } finally { setBusy(false); }
  };
  // A little pixel tap: devnet coins on demand.
  return (
    <button className="faucet-btn" onClick={mint} disabled={busy} title="Devnet faucet: 10,000 each of $STOOK, $ZCAT, $KNOTS, $GP and test USDC">
      <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true"><g fill="#c9bfa4"><rect x="1" y="3" width="8" height="3"/><rect x="8" y="3" width="3" height="2"/><rect x="2" y="1" width="2" height="2"/><rect x="0" y="4" width="1" height="1"/><rect x="9" y="5" width="2" height="2"/></g><rect x="9" y="8" width="2" height="1" fill="#35c4c4"/><rect x="9" y="10" width="2" height="1" fill="#35c4c4"/></svg>
      <span>{busy ? "minting…" : "test coins"}</span>
    </button>
  );
}

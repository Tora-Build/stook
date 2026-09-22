// Starting a day's round from the calendar: one input, the seed. The round's
// terms are fixed by the program (1% fee, 1% bands around the opening price,
// locks two minutes before the close), so there is nothing else to choose.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { anchorOf, feedHexToBytes, mintOf, type Coin } from "../lib/coins";
import { ataOf } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

const TIER = 2; // 1% bands

export function StartRound({ coin, settlesAt, onClose }: { coin: Coin; settlesAt: number; onClose: () => void }) {
  const nav = useNavigate();
  const { publicKey } = useWallet();
  const send = useSend("Round started");
  const mintKey = mintOf(coin);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const [text, setText] = useState("1000");
  const dec = mint.data?.decimals ?? coin.decimals;
  const seed = parseAmount(text, dec);
  const anchor = anchorOf(coin);
  const when = new Date(settlesAt * 1000).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const gross = seed && mint.data?.report.transferFee ? stook.grossFor(seed, mint.data.report.transferFee) : seed;

  const start = () => {
    if (!publicKey || !mintKey || !mint.data || !seed) return;
    const key = { feedId: feedHexToBytes(anchor.feedId), settlesAt: BigInt(settlesAt), quoteMint: mintKey, tier: TIER };
    send.mutate([stook.createLadderIx({ ...key, creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram, seed, issuerTrusted: mint.data.report.verdict === "issuer-trusted" })],
      { onSuccess: () => nav(`/m/${stook.deriveLadderPda(key).toBase58()}`) });
  };

  return (
    <div className="sheet-back" onClick={onClose}>
      <section className="panel sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Start ${coin.symbol}'s round for {when}</h3>
        <p className="explain">Your seed is the round's first liquidity: it buys depth at even odds across 64 bands of 1% around the {anchor.name} price when the round opens, earns 80% of every fee from the first trade, and the most it can lose is itself. Everyone after you adds to this same round.</p>
        <label className="field"><span>Seed ({coin.symbol})</span>
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus />
          <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"}{gross && seed && gross !== seed ? ` · your wallet sends ${fmtAmount(gross, dec)} (the coin's ${coin.feeBps / 100}% transfer fee)` : ""}</span>
        </label>
        <button className="primary" disabled={!publicKey || !seed || !mint.data || send.isPending} onClick={start}>
          {!publicKey ? "Connect a wallet" : send.isPending ? "Starting…" : "Start the round"}
        </button>
        <button className="link" onClick={onClose} style={{ marginTop: ".8rem" }}>cancel</button>
      </section>
    </div>
  );
}

// Funding a day's round from the calendar: one input, the seed. The round's
// terms are fixed by the program and the coin (1% fee, the anchor's band
// width, opens a day before the close, locks an hour before), so there is
// nothing else to choose.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { anchorOf, feedHexToBytes, mintOf, type Coin } from "../lib/coins";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

export function StartRound({ coin, settlesAt, onClose }: { coin: Coin; settlesAt: number; onClose: () => void }) {
  const nav = useNavigate();
  const { publicKey } = useWallet();
  const send = useSend("Round funded");
  const mintKey = mintOf(coin);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const [text, setText] = useState("1000");
  const dec = mint.data?.decimals ?? coin.decimals;
  const seed = parseAmount(text, dec);
  const anchor = anchorOf(coin);
  const when = new Date(settlesAt * 1000).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const times = stook.roundTimes(BigInt(Math.floor(Date.now() / 1000)), BigInt(settlesAt));
  const opens = new Date(Number(times.opensAt) * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const band = stook.STEP_BPS[anchor.tier]! / 100;
  const gross = seed && mint.data?.report.transferFee ? stook.grossFor(seed, mint.data.report.transferFee) : seed;

  const start = () => {
    if (!publicKey || !mintKey || !mint.data || !seed) return;
    const key = { feedId: feedHexToBytes(anchor.feedId), settlesAt: BigInt(settlesAt), quoteMint: mintKey, tier: anchor.tier };
    // Create writes the opening odds (up to 32 exponentials) and moves the
    // seed: measured 70K to 85K; the create-ATA and a Token-2022 transfer add more.
    send.mutate({ computeUnits: 200_000, ixs: [ensureAta(mintKey, publicKey, mint.data.tokenProgram), stook.createLadderIx({ ...key, creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram, seed, issuerTrusted: mint.data.report.verdict === "issuer-trusted" })] },
      { onSuccess: () => nav(`/m/${stook.deriveLadderPda(key).toBase58()}`) });
  };

  return (
    <div className="sheet-back" onClick={onClose}>
      <section className="panel sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Fund ${coin.symbol}'s round for {when}</h3>
        <p className="explain">Your seed is the house for this round. It opens {opens} on the {anchor.name} price then, in bands of {band}%, with the odds of an ordinary day already priced in. You earn 80% of the 1% fee on every trade. If the close lands far from the open, the winners are paid from your seed, and it can lose all of it. Anyone can add to the same round.</p>
        <label className="field"><span>Seed ({coin.symbol})</span>
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus />
          <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"}{gross && seed && gross !== seed ? ` · your wallet sends ${fmtAmount(gross, dec)} (the coin's ${coin.feeBps / 100}% transfer fee)` : ""}</span>
        </label>
        {balance.data !== undefined && !!seed && !!gross && balance.data < gross && <p className="warn">You hold {fmtAmount(balance.data, dec)} {coin.symbol}; this needs {fmtAmount(gross, dec)}. On devnet, use <b>Get test coins</b> in the header first.</p>}
        <button className="primary" disabled={!publicKey || !seed || !mint.data || send.isPending || (balance.data !== undefined && !!gross && balance.data < gross)} onClick={start}>
          {!publicKey ? "Connect a wallet" : send.isPending ? "Funding…" : "Fund the round"}
        </button>
        <button className="link" onClick={onClose} style={{ marginTop: ".8rem" }}>cancel</button>
      </section>
    </div>
  );
}

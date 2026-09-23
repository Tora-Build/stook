// Funding a day's round from the calendar: one input, the seed. The round's
// terms are fixed by the program and the coin (2% fee rising to 5% over the
// last six hours, the anchor's band
// width, opens a day before the close, locks an hour before), so there is
// nothing else to choose.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import type { PublicKey } from "@solana/web3.js";
import { anchorOf, isDevnet, mintOf, standInNote, type Coin } from "../lib/coins";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

export function StartRound({ coin, seriesKey, series, index, onClose }: { coin: Coin; seriesKey: PublicKey; series: stook.SeriesAccount; index: number; onClose: () => void }) {
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
  // Exactly what the program will write if this lands now.
  const terms = stook.roundTerms(series, index, BigInt(Math.floor(Date.now() / 1000)));
  const settlesAt = Number(terms.settlesAt);
  const when = new Date(settlesAt * 1000).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const opens = new Date(Number(terms.opensAt) * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const locks = new Date(Number(terms.locksAt) * 1000).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const band = terms.stepBps / 100;
  // bands 1..62 are finite; 0 and 63 are open-ended tails
  const up = (Math.exp((31 * terms.stepBps) / 10_000) - 1) * 100, down = (1 - Math.exp((-31 * terms.stepBps) / 10_000)) * 100;
  const dailyMove = Math.sqrt(Number(series.varWad) / 1e18) * 100;
  const gross = seed && mint.data?.report.transferFee ? stook.grossFor(seed, mint.data.report.transferFee) : seed;

  const start = () => {
    if (!publicKey || !mintKey || !mint.data || !seed) return;
    const key = { series: seriesKey, index, quoteMint: mintKey };
    // Create writes the opening odds (up to 32 exponentials) and moves the
    // seed: measured 70K to 85K; the create-ATA and a Token-2022 transfer add more.
    send.mutate({ computeUnits: 200_000, ixs: [ensureAta(mintKey, publicKey, mint.data.tokenProgram), stook.createLadderIx({ ...key, creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram, seed, issuerTrusted: mint.data.report.verdict === "issuer-trusted" })] },
      { onSuccess: () => nav(`/m/${stook.deriveLadderPda(key).toBase58()}`) });
  };

  return (
    <div className="sheet-back" onClick={onClose}>
      <section className="panel sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Fund ${coin.symbol}'s round for {when}</h3>
        {standInNote(coin) && <p className="warn">{standInNote(coin)}</p>}
        <dl className="quote terms">
          <div><dt>trading</dt><dd className="mono">{opens} to {locks}</dd></div>
          <div><dt>bands</dt><dd className="mono">set when it opens; at today's volatility {band.toFixed(2)}% each, from −{down.toFixed(0)}% to +{up.toFixed(0)}% around the open</dd></div>
          <div><dt>because {anchor.symbol} moves</dt><dd className="mono">about {dailyMove.toFixed(1)}% a day lately</dd></div>
        </dl>
        <p className="hint">Your wallet also shows about 0.019 SOL{isDevnet ? " (devnet SOL: set your wallet to devnet)" : ""}. That is account rent for the round, not a payment: 0.007 comes back when you claim your deposit, the rest when the round closes.</p>
        <p className="explain">Your seed is the house for this round. It opens on the {anchor.name} price at {opens}, with bands sized to how {anchor.name} is moving then and the odds of an ordinary day already priced in. The pool keeps 90% of every trade's fee: 2%, rising to 5% over the last six hours, when the sharpest trading happens. It is shared by depth with everyone who adds to it. If the close lands far from the open, the winners are paid from your seed, and it can lose all of it. Anyone can add to the same round.</p>
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

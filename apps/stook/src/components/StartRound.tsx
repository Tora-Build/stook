// Funding a day's round: a house ticket. The round's terms are fixed by the
// program and the coin (the fee, the band width at open, when it opens and
// locks), so the one thing to choose is the seed; the ticket shows the day's
// timeline and the deal in three lines, and the How page has the rest.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import type { PublicKey } from "@solana/web3.js";
import { isDevnet, mintOf, standInNote, type Coin } from "../lib/coins";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";
import { Usd, fmtUsd, fromUsd, toUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { RoundBar } from "./RoundBar";

export function StartRound({ coin, seriesKey, series, index, onClose }: { coin: Coin; seriesKey: PublicKey; series: stook.SeriesAccount; index: number; onClose: () => void }) {
  const nav = useNavigate();
  const { publicKey } = useWallet();
  const send = useSend("Round funded");
  const mintKey = mintOf(coin);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const [text, setText] = useState("1000");
  const [inUsd, setInUsd] = useState(false);
  const rate = useUsdRates().data?.[coin.symbol] ?? null;
  const dec = mint.data?.decimals ?? coin.decimals;
  const seed = inUsd && rate ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, rate) : parseAmount(text, dec);
  // Exactly what the program will write if this lands now.
  const terms = stook.roundTerms(series, index, BigInt(Math.floor(Date.now() / 1000)));
  const settlesAt = Number(terms.settlesAt);
  // Round times on New York's clock, like the calendar they were picked from.
  const when = nyWhen(settlesAt, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
      <section className="panel sheet ticket-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="fund-title">
        <header className="ts-head">
          <span className="ts-sign">House ticket</span>
          <h3 id="fund-title">${coin.symbol} · {when} NY</h3>
          <button className="ts-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        {standInNote(coin) && <p className="warn">{standInNote(coin)}</p>}

        <div className="ts-clock">
          <RoundBar opensAt={Number(terms.opensAt)} locksAt={Number(terms.locksAt)} settlesAt={settlesAt} />
        </div>

        <div className="ts-terms">
          <div><b>Earn</b><span>90% of every fee, 2% rising to 5%</span></div>
          <div><b>Risk</b><span>up to your seed, if it closes far from the open</span></div>
          <div><b>Refund</b><span>if it can't open or settle, deposits first</span></div>
        </div>

        <div className="field">
          <div className="amount-head">
            <span>Seed</span>
            <div className="seg seg-sm" role="group" aria-label="Enter the seed in">
              <button className={!inUsd ? "on" : ""} onClick={() => setInUsd(false)}>{coin.symbol}</button>
              {rate !== null && <button className={inUsd ? "on" : ""} onClick={() => setInUsd(true)}>USD</button>}
            </div>
          </div>
          <div className={`amount-input ${inUsd ? "amount-usd" : ""}`}>
            {inUsd && <span className="amount-sign">$</span>}
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus aria-label={inUsd ? "Seed in dollars" : `Seed in ${coin.symbol}`} />
            {!inUsd && <span className="amount-unit">{coin.symbol}</span>}
          </div>
          <span className="hint">{inUsd && seed ? <>{fmtAmount(seed, dec)} {coin.symbol} · </> : !inUsd && seed && rate !== null ? <>{fmtUsd(toUsd(seed, dec, rate))} · </> : null}balance {balance.data !== undefined ? <>{fmtAmount(balance.data, dec)} <Usd units={balance.data} decimals={dec} rate={rate} /></> : "…"}{gross && seed && gross !== seed ? ` · your wallet sends ${fmtAmount(gross, dec)} (the coin's ${(mint.data?.report.transferFee?.bps ?? 0) / 100}% transfer fee)` : ""}</span>
        </div>
        {balance.data !== undefined && !!seed && !!gross && balance.data < gross && <p className="warn">You hold {fmtAmount(balance.data, dec)} {coin.symbol}; this needs {fmtAmount(gross, dec)}. On devnet, use <b>test coins</b> in the header first.</p>}
        <button className="primary" disabled={!publicKey || !seed || !mint.data || send.isPending || (balance.data !== undefined && !!gross && balance.data < gross)} onClick={start}>
          {!publicKey ? "Connect a wallet" : send.isPending ? "Funding…" : `Fund the round${seed ? ` with ${fmtAmount(seed, dec)} ${coin.symbol}${rate !== null ? ` · ${fmtUsd(toUsd(seed, dec, rate))}` : ""}` : ""}`}
        </button>
        <p className="ts-rent" title={`Account rent for the round, not a payment: about 0.009 SOL comes back when you claim your deposit, the rest when the round closes.${isDevnet ? " Devnet SOL: set your wallet to devnet." : ""}`}>+ about 0.026 {isDevnet ? "devnet " : ""}SOL rent, returned to you later</p>
      </section>
    </div>
  );
}

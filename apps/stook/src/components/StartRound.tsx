// Funding a day's round: a house ticket. The round's terms are fixed by the
// program and the coin (the fee, the band width at open, when it opens and
// locks), so the one thing to choose is the seed; the ticket shows the day's
// times and the deal in a few lines, and the How page has the rest.
import { useEffect, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import type { PublicKey } from "@solana/web3.js";
import { isDevnet, mintOf, standInNote, type Coin } from "../lib/coins";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtCompact, parseAmount } from "../lib/format";
import { approxUsd, coinText, fromUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";

export function StartRound({ coin, seriesKey, series, index, onClose }: { coin: Coin; seriesKey: PublicKey; series: stook.SeriesAccount; index: number; onClose: () => void }) {
  const nav = useNavigate();
  const { publicKey } = useWallet();
  const modal = useWalletModal();
  // Esc closes it, as the backdrop does.
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const send = useSend("Round funded");
  const mintKey = mintOf(coin);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const rate = useUsdRates().data?.[coin.symbol] ?? null;
  // Dollars first when the coin has a price, as everywhere else.
  const [unitPicked, setInUsd] = useState<boolean | null>(null);
  const inUsd = unitPicked ?? rate !== null;
  const [typed, setText] = useState<string | null>(null);
  const text = typed ?? (inUsd ? "20" : "1000");
  const dec = mint.data?.decimals ?? coin.decimals;
  const seed = inUsd && rate ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, rate) : parseAmount(text, dec);
  // Exactly what the program will write if this lands now.
  const terms = stook.roundTerms(series, index, BigInt(Math.floor(Date.now() / 1000)));
  const settlesAt = Number(terms.settlesAt);
  // Round times on New York's clock, like the calendar they were picked from.
  const when = nyWhen(settlesAt, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const gross = seed && mint.data?.report.transferFee ? stook.grossFor(seed, mint.data.report.transferFee) : seed;
  // The most the seed may take from the wallet, signed with it at the fee in
  // force. A higher fee the issuer has scheduled would take more, so if it
  // starts first the round is not started: that is said, not signed for.
  const next = mint.data?.report.nextTransferFee;
  const maxGross = seed ? stook.maxGrossFor(seed, [mint.data?.report.transferFee], 0n) : null;
  const rising = seed ? stook.feeRaises(seed, mint.data?.report.transferFee, next) : false;

  const start = () => {
    if (!publicKey || !mintKey || !mint.data || !seed || maxGross === null) return;
    const key = { series: seriesKey, index, quoteMint: mintKey };
    // Create writes the opening odds (up to 32 exponentials) and moves the
    // seed: measured 70K to 85K; the create-ATA and a Token-2022 transfer add more.
    send.mutate({ computeUnits: 200_000, ixs: [ensureAta(mintKey, publicKey, mint.data.tokenProgram), stook.createLadderIx({ ...key, creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram, seed, maxGross, issuerTrusted: mint.data.report.verdict === "issuer-trusted" })] },
      { onSuccess: () => nav(`/m/${stook.deriveLadderPda(key).toBase58()}`) });
  };


  const t = (x: number | bigint) => nyWhen(x, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const short = balance.data !== undefined && !!seed && !!gross && balance.data < gross;

  return (
    <div className="house-modal-back" onClick={onClose}>
      <section className="card house-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="fund-title">
        <header className="house-modal-head">
          <div>
            <div className="kicker taxi">FUND A ROUND</div>
            <h3 id="fund-title">${coin.symbol} · {when} NY</h3>
          </div>
          <button className="btn btn-sm btn-ghost house-modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        {standInNote(coin) && <p className="house-note">{standInNote(coin)}</p>}

        <div className="house-modal-times">
          <div><span className="label">Opens</span><b>{t(terms.opensAt)}</b></div>
          <div><span className="label">Trading stops</span><b>{t(terms.locksAt)}</b></div>
          <div><span className="label">Bell</span><b>{t(settlesAt)}</b></div>
        </div>

        <div className="house-modal-field">
          <div className="house-row">
            <span className="label">Seed</span>
            <div className="seg2" role="group" aria-label="Enter the seed in">
              {rate !== null && <button className={inUsd ? "on" : ""} onClick={() => { setInUsd(true); setText(null); }}>USD</button>}
              <button className={!inUsd ? "on" : ""} onClick={() => { setInUsd(false); setText(null); }}>{coin.symbol}</button>
            </div>
          </div>
          <label className="house-amt">
            {inUsd && <span className="house-amt-sign">$</span>}
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus aria-label={inUsd ? "Seed in dollars" : `Seed in ${coin.symbol}`} />
            {!inUsd && <span className="house-amt-alt">{coin.symbol}</span>}
          </label>
          <div className="house-row dimmer"><span>Balance</span><b className="num">{balance.data !== undefined ? <>{coinText(balance.data, dec, coin.symbol)}{rate !== null ? ` · ${approxUsd(balance.data, dec, rate)}` : ""}</> : "…"}</b></div>
        </div>

        {!!seed && !!gross && <div className="house-modal-sum">
          <div className="house-row"><span>You pay</span><b className="num">{coinText(gross, dec, coin.symbol)}{rate !== null && <small className="dimmer"> {approxUsd(gross, dec, rate)}</small>}</b></div>
          {gross !== seed && <div className="house-row dimmer"><span>Includes the {(mint.data?.report.transferFee?.bps ?? 0) / 100}% transfer fee</span></div>}
          <div className="house-row"><span>Your share</span><b className="num">100%, first in</b></div>
          <div className="house-row dimmer"><span>Your cut</span><b className="up">90% of every fee</b></div>
        </div>}
        {!!seed && rising && <p className="house-note taxi">The issuer will raise the transfer fee to {next!.bps / 100}%. If that comes first, this fails and nothing moves.</p>}
        {short && <p className="house-note down">Not enough {coin.symbol}: you hold {fmtCompact(balance.data!, dec)}, this needs {fmtCompact(gross!, dec)}.{isDevnet ? " Get test coins with Faucet in the header." : ""}</p>}
        {!publicKey ? <button className="btn btn-block" onClick={() => modal.setVisible(true)}>Connect a wallet</button>
          : <button className="btn btn-block" disabled={!seed || !mint.data || send.isPending || short} onClick={start}>
              {send.isPending ? "Funding…" : `Fund the round${seed ? ` with ${coinText(seed, dec, coin.symbol)}` : ""}`}
            </button>}
        <p className="house-risk" title={`Account rent for the round, not a payment: about 0.009 SOL comes back when you claim your deposit, the rest when the round closes.${isDevnet ? " Devnet SOL: set your wallet to devnet." : ""}`}>Plus about 0.026 {isDevnet ? "devnet " : ""}SOL rent, returned to you later</p>
      </section>
    </div>
  );
}

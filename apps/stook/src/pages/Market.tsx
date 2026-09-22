import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { Chart, type DrawMode } from "../components/Chart";
import { TradePanel } from "../components/TradePanel";
import { Positions } from "../components/Positions";
import { LpPanel } from "../components/LpPanel";
import { useLadder, useLivePrice, useMint, useRefs, useSend } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { feedByHex, feedHex } from "../lib/feeds";
import { fmtAmount, fmtPrice, fmtWhen, untilText, short } from "../lib/format";
import { EXPLORER } from "../lib/config";
import { Live } from "../components/Live";
import { coinByMint } from "../lib/coins";
import { useQuery } from "@tanstack/react-query";

export function Market() {
  const { id } = useParams();
  const key = useMemo(() => { try { return new PublicKey(id!); } catch { return null; } }, [id]);
  const ladder = useLadder(key);
  const l = ladder.data;
  const mint = useMint(l?.quoteMint ?? null);
  const refs = useRefs(key, l, mint.data?.tokenProgram);
  const now = useNow();
  const { publicKey } = useWallet();
  const [shape, setShape] = useState<stook.Shape | null>(null);
  const [mode, setMode] = useState<DrawMode>("line");
  const [height, setHeight] = useState(4);
  const live = useLivePrice(l?.feedId ?? null);
  const feedSym = l ? feedByHex(feedHex(l.feedId)).symbol : null;
  const history = useQuery({ queryKey: ["hist", feedSym], queryFn: async () => (await fetch(`/chart?sym=${feedSym}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!feedSym, refetchInterval: 300_000 });
  const voidIt = useSend("Void");

  if (!key) return <p className="page muted">Not a market address.</p>;
  if (ladder.isLoading) return <p className="page muted">Reading the market…</p>;
  if (!l || !refs) return <p className="page muted">{l === null ? "No market at this address." : "Reading the quote token…"}</p>;

  const feed = feedByHex(feedHex(l.feedId));
  const coin = coinByMint(l.quoteMint);
  const quoteSymbol = coin ? coin.symbol : mint.data?.decimals === 6 ? "USDC" : "tokens";
  const tradeable = l.status === "open" && now < Number(l.locksAt);
  const step = stook.nextStep(l, BigInt(now));
  const setHeightAndShape = (h: number) => { setHeight(h); if (shape && shape.h > 1) setShape(stook.tent((shape.lo + shape.hi) / 2, h)); };

  return (
    <div className="page market">
      <header className="market-head">
        <div>
          {coin && <span className="sign">${coin.symbol} ROUND</span>}
          <h1>{feed.name} <span className="sym">{feed.symbol}</span></h1>
          <p className="live-row"><Live l={l} dp={feed.dp} /></p>
          <p className="muted">settles {fmtWhen(l.settlesAt)} · {l.stepBps / 100}% bands · fee {l.feeBps / 100}% · funded by {short(l.sponsor)} · <a href={EXPLORER("address", key.toBase58())} target="_blank" rel="noreferrer">account</a></p>
        </div>
        <Status l={l} now={now} step={step} />
      </header>

      <Chart
        curve={l.curve}
        p0={l.p0 || (live.data?.price ?? 1n)}
        expo={l.p0Expo || (live.data?.expo ?? -8)}
        stepBps={l.stepBps}
        dp={feed.dp}
        shape={shape}
        onShape={setShape}
        mode={mode}
        height={height}
        live={live.data && live.data.price > 0n ? { price: live.data.price } : null}
        history={history.data?.points}
        settlesAt={l.settlesAt}
        now={now}
        settledBin={l.settledBin}
        disabled={!tradeable}
      />

      <div className="cols">
        <div>
          <TradePanel refs={refs} ladder={l} shape={shape} mode={mode} setMode={setMode} height={height} setHeight={setHeightAndShape} symbol={feed.symbol} dp={feed.dp} quoteSymbol={quoteSymbol} tradeable={tradeable} transferFee={mint.data?.report.transferFee} />
          <Positions refs={refs} ladder={l} dp={feed.dp} quoteSymbol={quoteSymbol} onPick={setShape} />
        </div>
        <div>
          <LpPanel refs={refs} ladder={l} quoteSymbol={quoteSymbol} now={now} transferFee={mint.data?.report.transferFee} />
          <section className="panel">
            <h3>Market</h3>
            <dl className="quote">
              <div><dt>pool cash</dt><dd className="mono">{fmtAmount(l.cash, l.decimals)} {quoteSymbol}</dd></div>
              <div><dt>owed if the favourite lands</dt><dd className="mono">{fmtAmount(l.payout.reduce((a, b) => (b > a ? b : a), 0n), l.decimals)}</dd></div>
              <div><dt>fees to LPs / creator / protocol</dt><dd className="mono">{fmtAmount(l.feesLp, l.decimals)} / {fmtAmount(l.feesCreator, l.decimals)} / {fmtAmount(l.feesProtocol, l.decimals)}</dd></div>
              <div><dt>trades</dt><dd className="mono">{l.curveSeq.toString()}</dd></div>
            </dl>
            {step === "void" && publicKey && (
              <button className="small" onClick={() => voidIt.mutate([stook.voidLadderIx(refs, publicKey)])} disabled={voidIt.isPending}>Void this market</button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Status({ l, now, step }: { l: stook.LadderAccount; now: number; step: stook.CrankStep | null }) {
  const text =
    l.status === "seeding" ? (step === "open" ? "Waiting for the keeper to open it from the live price" : step === "void" ? "Never opened — can be voided" : `Taking liquidity · opens in ${untilText(l.opensAt, now)}`)
    : l.status === "open" ? (now < Number(l.locksAt) ? `Trading · locks in ${untilText(l.locksAt, now)}` : step === "settle" ? "Settling — the keeper posts the price within a minute" : step === "void" ? "Price never arrived — can be voided" : `Locked · settles in ${untilText(l.settlesAt, now)}`)
    : l.status === "settled" ? `Settled in band ${l.settledBin} — ${fmtPrice(stook.binBounds(l.settledBin!, l.p0, l.stepBps)[0], l.p0Expo, 2)} to ${stook.binBounds(l.settledBin!, l.p0, l.stepBps)[1] === Infinity ? "∞" : fmtPrice(stook.binBounds(l.settledBin!, l.p0, l.stepBps)[1], l.p0Expo, 2)}`
    : "Void — everyone is refunded what they paid";
  return <div className={`status status-${l.status}`}>{text}</div>;
}

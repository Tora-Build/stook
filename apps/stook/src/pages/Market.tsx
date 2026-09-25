import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { Chart, type DrawMode } from "../components/Chart";
import { Ticket } from "../components/Ticket";
import { Address } from "../components/Address";
import { Tour, tourSeen, type TourStop } from "../components/Tour";
import { approxUsd, coinText, useUsdPerCoin } from "../lib/usd";
import { Bell } from "../components/Bell";
import { Notice } from "../components/Notice";
import { useLadder, useLivePrice, useMint, usePositions, useRefs, useSend, useSeries, useTranches } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { feedByHex, feedHex } from "../lib/feeds";
import { coinByMint, standInNote } from "../lib/coins";
import { fmtCompact, fmtPrice, untilText } from "../lib/format";
import { nyWhen } from "../lib/time";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<DrawMode>("line");
  const [height, setHeight] = useState(4);
  // The floor guide opens by itself on a first visit, once the round is read.
  const [touring, setTouring] = useState(false);
  const live = useLivePrice(l?.feedId ?? null);
  const feedSym = l ? feedByHex(feedHex(l.feedId)).symbol : null;
  const history = useQuery({ queryKey: ["hist", feedSym], queryFn: async () => (await fetch(`/chart?sym=${feedSym}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!feedSym, refetchInterval: 300_000 });
  const positions = usePositions(key);
  const tranches = useTranches(key, true);
  const voidIt = useSend("Void");
  const series = useSeries(l?.series ?? null);
  // Dollars per whole coin, for the dollar value beside every amount.
  const usd = useUsdPerCoin(l?.quoteMint, mint.data?.decimals === 6 ? "USDC" : undefined);

  // The tour shows the call flow on a sample call at the crowd's favourite
  // band, placed only if nothing is picked, and taken back when it ends.
  const [demo, setDemo] = useState<stook.Shape | null>(null);
  const startTour = () => {
    const d = ladder.data;
    if (!shape && !selected && d && d.status === "open" && Date.now() / 1000 < Number(d.locksAt)) {
      const w = d.curve.w, k = w.reduce((best, v, i) => (v > w[best]! ? i : best), 0);
      const s = mode === "line" ? stook.tent(k, height) : stook.band(Math.max(0, k - 1), Math.min(63, k + 1));
      setShape(s); setDemo(s);
    }
    setTouring(true);
  };
  const endTour = () => { setTouring(false); if (demo && shape === demo) setShape(null); setDemo(null); };
  const loaded = !!ladder.data && !!refs;
  useEffect(() => { if (loaded && !tourSeen()) startTour(); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key) return <p className="page muted">Not a round address.</p>;
  if (ladder.isLoading) return <p className="page muted">Reading the round…</p>;
  if (!l || !refs) return <p className="page muted">{l === null ? "No round at this address." : "Reading the quote token…"}</p>;

  // A round that has not opened has no bands yet: they are set at open from
  // the volatility then, over the round's window. Show the ones it would get
  // from the volatility now. None while the series is still learning.
  const preview = l.status === "seeding" && l.b === 0n && series.data && series.data.varWad > 0n && l.opensAt < l.settlesAt ? (() => { try { return stook.openingTerms(series.data.varWad, l.settlesAt, l.opensAt); } catch { return null; } })() : null;
  const shown: stook.LadderAccount = preview ? { ...l, curve: preview.curve, stepBps: preview.stepBps } : l;
  const feed = feedByHex(feedHex(l.feedId));
  const coin = coinByMint(l.quoteMint);
  // On devnet the round runs on a stand-in feed: show that feed, not the anchor's logo and mint.
  const standIn = coin ? standInNote(coin) : null;
  const quoteSymbol = coin ? coin.symbol : mint.data?.decimals === 6 ? "USDC" : "tokens";
  const tradeable = l.status === "open" && now < Number(l.locksAt);
  const final = l.status === "settled" || l.status === "void";
  const step = stook.nextStep(l, BigInt(now));
  const mine = (positions.data ?? []).filter((r) => r.position.shares > 0n || final);
  const sel = mine.find((r) => r.pubkey.toBase58() === selected) ?? null;
  const setHeightAndShape = (h: number) => { setHeight(h); if (shape && shape.h > 1) setShape(stook.tent((shape.lo + shape.hi) / 2, h)); };
  const livePrice = live.data && live.data.price > 0n ? Number(live.data.price) * 10 ** live.data.expo : null;
  const openPrice = l.p0 > 0n ? Number(l.p0) * 10 ** l.p0Expo : null;
  // A band in dollars: the step times the price it is measured from.
  const stepBps = preview ? preview.stepBps : l.stepBps;
  const bandUsd = stepBps > 0 && (openPrice ?? livePrice) !== null ? ((openPrice ?? livePrice)! * stepBps) / 10_000 : null;
  // After the close the keeper settles within seconds, or, if the close's
  // price cannot settle it, voids it with that price as proof. If neither has
  // happened after a few minutes, the round waits; with no price to show at
  // all, it can be voided a week after the close.
  const waiting = l.status === "open" && now > Number(l.settlesAt) + 300;
  const stateText = l.status === "seeding" ? (step === "void" ? "never opened" : now < Number(l.opensAt) ? `funded · opens in ${untilText(l.opensAt, now)}` : "opening") : l.status === "open" ? (now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : waiting ? (step === "void" ? "no settlement price · can be voided" : `waiting for the settlement price · if none can settle it, void in ${untilText(l.settlesAt + stook.VOID_FALLBACK_SECS, now)}`) : now >= Number(l.settlesAt) ? "the bell is ringing" : `locked · bell in ${untilText(l.settlesAt, now)}`) : l.status === "settled" ? `landed in band ${l.settledBin}` : "void";

  return (
    <div className="page market">
      {/* The round's board: who it is and when the bell rings on top, the
          numbers that move on a tape below. */}
      <header className="round-board" data-tour="round">
        <div className="board-top">
          <div className="strip-id">
            {/* What the round is on leads; the coin is what it is paid in. */}
            <div className="anchor-mark">{coin && !standIn ? <img src={coin.anchor.logo} alt="" /> : <span className="tick">{feed.symbol}</span>}</div>
            <div>
              <div className="strip-title">{feed.name} <span className="sym">{feed.symbol}</span></div>
              <div className="board-sub">
                {coin && <span className="paid-in"><img src={coin.logo} alt="" />paid in <b>${coin.symbol}</b></span>}
                <span>{nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric" })} · closes {nyWhen(l.settlesAt, { hour: "numeric", minute: "2-digit" })} New York</span>
                {coin && !standIn && <Address label={`${coin.anchor.symbol}`} value={coin.anchor.mint} />}
              </div>
            </div>
          </div>
          <div className={`status status-${l.status}`} data-tour="clock"><Bell ringing={l.status === "open" && now >= Number(l.settlesAt)} rung={l.status === "settled"} />{l.status === "open" && now < Number(l.settlesAt)
            ? <span className="status-lines"><span>rings in {untilText(l.settlesAt, now)}</span><span className="status-sub">{now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : "locked · no more trades"}</span></span>
            : stateText}</div>
          <button className="tour-btn" onClick={startTour} aria-label="Open the floor guide">? Floor guide</button>
        </div>
        <div className="board-tape">
          <div className="tape-cell"><span className="strip-k">now</span><b className="mono">{livePrice !== null ? `$${fmtPrice(BigInt(Math.round(livePrice / 10 ** live.data!.expo)), live.data!.expo, feed.dp)}` : "…"}</b>
            {livePrice !== null && openPrice !== null && <em className={`mono ${livePrice >= openPrice ? "up" : "down"}`}>{livePrice >= openPrice ? "▲" : "▼"} {Math.abs((livePrice / openPrice - 1) * 100).toFixed(2)}% since open</em>}</div>
          {openPrice !== null && <div className="tape-cell"><span className="strip-k">opened at</span><b className="mono">${fmtPrice(l.p0, l.p0Expo, feed.dp)}</b><em>{nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} New York</em></div>}
          <div className="tape-cell"><span className="strip-k">pool</span><b className="mono">{fmtCompact(l.depositTotal, l.decimals)}{usd !== null && <span className="approx">{approxUsd(l.depositTotal, l.decimals, usd)}</span>}</b><em>{quoteSymbol} in the house</em></div>
          <div className="tape-cell"><span className="strip-k">house fees</span><b className="mono tape-up">{fmtCompact(l.feesLp, l.decimals)}{usd !== null && <span className="approx">{approxUsd(l.feesLp, l.decimals, usd)}</span>}</b><em>{quoteSymbol}, 90% of fees</em></div>
          <div className="tape-cell" title="What traders have paid for calls still open in this round"><span className="strip-k">traders in</span><b className="mono">{fmtCompact(l.basisTotal, l.decimals)}{usd !== null && <span className="approx">{approxUsd(l.basisTotal, l.decimals, usd)}</span>}</b><em>{quoteSymbol} on open calls</em></div>
          <div className="tape-cell" title="The chart splits the price into bands of equal percentage steps. A call picks bands; the close lands in exactly one.">
            <span className="strip-k">each band</span>
            <b className="mono">{bandUsd !== null ? `$${bandUsd.toLocaleString("en-US", { maximumSignificantDigits: 3 })}` : `${(stepBps / 100).toFixed(2)}%`} wide</b>
            <em>{(stepBps / 100).toFixed(2)}% of the price{preview ? ", set when it opens" : ""}</em>
          </div>
        </div>
      </header>
      <Tour open={touring} onClose={endTour} stops={tourStops(feed.name, quoteSymbol)} />
      {standIn && <Notice tone="info" title="Devnet stand-in" className="standin">{standIn}</Notice>}

      <div className="market-grid">
        <Chart
          curve={shown.curve} p0={l.p0 || (live.data?.price ?? 1n)} expo={l.p0Expo || (live.data?.expo ?? -8)} stepBps={shown.stepBps || 100} dp={feed.dp} opened={l.p0 > 0n}
          shape={shape} onShape={setShape} mode={mode} height={height}
          live={live.data && live.data.price > 0n ? { price: live.data.price } : null} history={history.data?.points} settlesAt={l.settlesAt} now={now}
          settledBin={l.settledBin} disabled={!tradeable}
          positions={mine.map((r) => ({ key: r.pubkey.toBase58(), shape: r.position.shape, shares: r.position.shares, label: coinText(r.position.netPaid, l.decimals, quoteSymbol) }))}
          selected={selected} onSelect={setSelected}
        />
        <Ticket refs={refs} ladder={shown} shape={shape} selected={sel} onSelect={(r) => { setSelected(r.pubkey.toBase58()); setShape(r.position.shape); }} onDeselect={() => { setSelected(null); setShape(null); }} mode={mode} setMode={setMode} height={height} setHeight={setHeightAndShape}
          symbol={feed.symbol} coinSymbol={coin?.symbol} dp={feed.dp} quoteSymbol={quoteSymbol} tradeable={tradeable} final={final} positions={mine} tranches={tranches.data ?? []} transferFee={mint.data?.report.transferFee} now={now} usd={usd} />
      </div>
      {step === "void" && publicKey && <p className="hint"><button className="link" onClick={() => voidIt.mutate([stook.voidLadderIx(refs, publicKey)])} disabled={voidIt.isPending}>This round cannot finish. Void it: deposits come back first, open lines share the rest</button></p>}
    </div>
  );
}

/** The floor guide's stops, in the order a first trade takes them. */
function tourStops(anchor: string, coin: string): TourStop[] {
  const c = coin === "USDC" || coin === "tokens" ? coin : `$${coin}`;
  return [
    { title: "Welcome to the floor", body: <>Where does <b>{anchor}</b> close at 4 PM New York? Call it on the board, paid in <b>{c}</b>. The closer it lands, the more it pays.</> },
    { target: "board", title: "The board", body: <>Each row is a price band; the blue bars are the crowd's odds. <b>Click a band</b> to call it.</> },
    { target: "shape", title: "Target or range", body: <>A <b>target</b> pays most on its band and tapers out to its <b>reach</b>. A <b>range</b> pays the same anywhere inside.</> },
    { target: "ladder", title: "What it pays", body: <>What each landing pays. Bars past the tag, your stake, make money; shorter ones soften a miss.</> },
    { target: "paper", title: "Your ticket", body: <>Spend in dollars or {c}. The ticket shows what you pay, the fee and what you win. Nothing is sent until you sign.</> },
    { target: "book", title: "Your calls", body: <>Calls you already hold here. Open one to add to it or sell it.</> },
    { target: "house", title: "Or be the house", body: <>Fund the pool instead: the house keeps 90% of the fees and risks at most what it puts in.</> },
    { target: "clock", title: "The bell", body: <>Trading stops shortly before the close. The first Pyth price at 4 PM settles the round; collect here after.</> },
  ];
}

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
import { Usd, useUsdPerCoin } from "../lib/usd";
import { Bell } from "../components/Bell";
import { useLadder, useLivePrice, useMint, usePositions, useRefs, useSend, useSeries, useTranches } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { feedByHex, feedHex } from "../lib/feeds";
import { coinByMint, standInNote } from "../lib/coins";
import { fmtAmount, fmtPrice, untilText } from "../lib/format";
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

  const loaded = !!ladder.data && !!refs;
  useEffect(() => { if (loaded && !tourSeen()) setTouring(true); }, [loaded]);

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
  // After the close the keeper settles within seconds, or, if the close's
  // price cannot settle it, voids it with that price as proof. If neither has
  // happened after a few minutes, the round waits; with no price to show at
  // all, it can be voided a week after the close.
  const waiting = l.status === "open" && now > Number(l.settlesAt) + 300;
  const stateText = l.status === "seeding" ? (step === "void" ? "never opened" : now < Number(l.opensAt) ? `funded · opens in ${untilText(l.opensAt, now)}` : "opening") : l.status === "open" ? (now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : waiting ? (step === "void" ? "no settlement price · can be voided" : `waiting for the settlement price · if none can settle it, void in ${untilText(l.settlesAt + stook.VOID_FALLBACK_SECS, now)}`) : now >= Number(l.settlesAt) ? "the bell is ringing" : `locked · bell in ${untilText(l.settlesAt, now)}`) : l.status === "settled" ? `landed in band ${l.settledBin}` : "void";

  return (
    <div className="page market">
      <header className="strip-head" data-tour="round">
        <div className="strip-id">
          {/* What the round is on leads; the coin is what it is paid in. */}
          <div className="anchor-mark">{coin && !standIn ? <img src={coin.anchor.logo} alt="" /> : <span className="tick">{feed.symbol}</span>}</div>
          <div>
            <div className="strip-title">{feed.name} <span className="sym">{feed.symbol}</span>{coin && <span className="paid-in"><img src={coin.logo} alt="" />paid in <b>${coin.symbol}</b></span>}</div>
            <div className="muted small">closes {nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} New York · {preview ? <>bands about {(preview.stepBps / 100).toFixed(2)}%, set when it opens</> : <>bands of {(l.stepBps / 100).toFixed(2)}%</>}{coin && !standIn && <> · <Address label={`${coin.anchor.symbol}`} value={coin.anchor.mint} /></>}</div>
          </div>
        </div>
        <div className="strip-num"><span className="strip-k">price</span><span className="mono strip-v">{livePrice !== null ? `$${fmtPrice(BigInt(Math.round(livePrice / 10 ** live.data!.expo)), live.data!.expo, feed.dp)}` : "…"}</span></div>
        <div className="strip-num"><span className="strip-k">pool</span><span className="mono strip-v">{fmtAmount(l.depositTotal, l.decimals, 0)} <span className="muted">{quoteSymbol}</span></span><Usd units={l.depositTotal} decimals={l.decimals} rate={usd} className="strip-usd" /></div>
        <div className={`status status-${l.status}`} data-tour="clock"><Bell ringing={l.status === "open" && now >= Number(l.settlesAt)} rung={l.status === "settled"} />{l.status === "open" && now < Number(l.settlesAt)
          ? <span className="status-lines"><span>rings in {untilText(l.settlesAt, now)}</span><span className="status-sub">{now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : "locked · no more trades"}</span></span>
          : stateText}</div>
        <button className="tour-btn" onClick={() => setTouring(true)} aria-label="Open the floor guide">? Guide</button>
      </header>
      <Tour open={touring} onClose={() => setTouring(false)} stops={tourStops(feed.name, quoteSymbol)} />
      {standIn && <p className="warn standin">{standIn}</p>}

      <div className="market-grid">
        <Chart
          curve={shown.curve} p0={l.p0 || (live.data?.price ?? 1n)} expo={l.p0Expo || (live.data?.expo ?? -8)} stepBps={shown.stepBps || 100} dp={feed.dp} opened={l.p0 > 0n}
          shape={shape} onShape={setShape} mode={mode} height={height}
          live={live.data && live.data.price > 0n ? { price: live.data.price } : null} history={history.data?.points} settlesAt={l.settlesAt} now={now}
          settledBin={l.settledBin} disabled={!tradeable}
          positions={mine.map((r) => ({ key: r.pubkey.toBase58(), shape: r.position.shape, shares: r.position.shares, label: `${fmtAmount(r.position.shares, l.decimals, 0)} sh` }))}
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
    { title: "Welcome to the floor", body: <>One round, one question: where does <b>{anchor}</b> close at 4 PM New York? You draw your answer on the board and pay in <b>{c}</b>. The closer the close lands to your line, the more it pays.</> },
    { target: "round", title: "The ticket", body: <>What this round follows, when it closes, the price now and how much is in the pool. Its bands are set when it opens, as wide as the price has been moving.</> },
    { target: "board", title: "The board", body: <>Each row is a price band. The blue bars are the crowd's odds: a long bar is a likely close, a short one a long shot. <b>Click a band</b> to draw your line there.</> },
    { target: "shape", title: "Line or range", body: <>A <b>line</b> pays most on its centre band and a little less on each band away. A <b>range</b> pays the same anywhere inside it: drag across the board to draw one.</> },
    { target: "reach", title: "Reach", body: <>How far a line tapers out. A wide reach catches more closes; a narrow one pays more when you are right.</> },
    { target: "order", title: "Your order", body: <>A range pays one {c} a share if the close lands inside; a line pays up to its reach on its centre band. Before you buy you see what you pay, the fee (2%, rising to 5% over the last six hours) and your best case. Nothing is sent until you sign.</> },
    { target: "house", title: "Or be the house", body: <>Fund the pool instead. The house takes the other side of every trade and keeps 90% of the fees. The most it can lose is what you put in.</> },
    { target: "clock", title: "The bell", body: <>Trading stops shortly before the close (an hour, for a round funded a day ahead). The first Pyth price at or after 4 PM settles the round, and winners collect here. If that price came late or unsure, the round is void: deposits come back first and open lines share the rest.</> },
  ];
}

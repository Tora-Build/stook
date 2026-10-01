import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { rangeName, SideSigns, Ticket, type SideTab } from "../components/Ticket";
import { Address } from "../components/Address";
import { Tower, type Phase } from "../components/Tower";
import { CallBar, CallKind, CallKindBar, ExactPrices } from "../components/TowerDesk";
import { AfterBell, guideDone, markGuideDone, TowerGuide, type WalletState } from "../components/Spotlight";
import { FAUCET_AUTHORITY_BYTES } from "../lib/config";
import { approxUsd, coinText, useUsdPerCoin } from "../lib/usd";
import { useLadder, useLivePrice, useMint, usePositions, useRefs, useSend, useSeries, useTranches } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { useDesk } from "../hooks/useDesk";
import { useCallOrder } from "../hooks/useCallOrder";
import { feedByHex, feedHex } from "../lib/feeds";
import { coinByMint, standInNote } from "../lib/coins";
import { fmtCompact, fmtPrice, untilText } from "../lib/format";
import { nyWhen } from "../lib/time";
import { callName, callShort, fromShape, makeGrid, nearAt, sameShape, toShape } from "../lib/call";
import type { MintInfo } from "../lib/chain";
import { Title } from "../components/Title";

export function Market() {
  const { id } = useParams();
  const key = useMemo(() => { try { return new PublicKey(id!); } catch { return null; } }, [id]);
  const ladder = useLadder(key);
  const l = ladder.data;
  const mint = useMint(l?.quoteMint ?? null);
  const refs = useRefs(key, l, mint.data?.tokenProgram);

  if (!key) return <p className="page muted">Not a round address.</p>;
  if (ladder.isLoading) return <p className="page muted">Reading the round…</p>;
  if (!l || !refs) return <p className="page muted">{l === null ? "No round at this address." : "Reading the quote token…"}</p>;
  return <Round key={key.toBase58()} l={l} refs={refs} mint={mint.data ?? undefined} />;
}

const hm = (t: number | bigint) => nyWhen(t, { hour: "numeric", minute: "2-digit" });

function Round({ l, refs, mint }: { l: stook.LadderAccount; refs: stook.LadderRefs; mint?: MintInfo }) {
  const now = useNow();
  const { publicKey } = useWallet();
  const live = useLivePrice(l.feedId);
  const feed = feedByHex(feedHex(l.feedId));
  const history = useQuery({ queryKey: ["hist", feed.symbol], queryFn: async () => (await fetch(`/chart?sym=${feed.symbol}`)).json() as Promise<{ points: [number, number][] }>, refetchInterval: 300_000 });
  const positions = usePositions(refs.ladder);
  const tranches = useTranches(refs.ladder, true);
  const voidIt = useSend("Void");
  const series = useSeries(l.series);
  // Dollars per whole coin, for the dollar value beside every amount.
  const usd = useUsdPerCoin(l.quoteMint, mint?.decimals === 6 ? "USDC" : undefined);
  const coarse = useCoarse();

  // A round that has not opened has no bands yet: they are set at open from
  // the volatility then, over the round's window. Show the ones it would get
  // from the volatility now. None while the series is still learning. A
  // round voided before it opened shows the same.
  const varWad = series.data?.varWad ?? 0n;
  const preview = useMemo(() => ((l.status === "seeding" || l.status === "void") && l.b === 0n && varWad > 0n && l.opensAt < l.settlesAt ? (() => { try { return stook.openingTerms(varWad, l.settlesAt, l.opensAt); } catch { return null; } })() : null), [l.status, l.b, varWad, l.settlesAt, l.opensAt]);
  const shown: stook.LadderAccount = useMemo(() => (preview ? { ...l, curve: preview.curve, stepBps: preview.stepBps } : l), [preview, l]);
  const coin = coinByMint(l.quoteMint);
  // On devnet the round runs on a stand-in feed: show that feed, not the anchor's logo and mint.
  const standIn = coin ? standInNote(coin) : null;
  const quoteSymbol = coin ? coin.symbol : mint?.decimals === 6 ? "USDC" : "tokens";
  const tradeable = l.status === "open" && now < Number(l.locksAt);
  const final = l.status === "settled" || l.status === "void";
  const step = stook.nextStep(l, BigInt(now));
  const mine = (positions.data ?? []).filter((r) => r.position.shares > 0n || final);
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
  const stateText = l.status === "seeding" ? (step === "void" ? "didn't open in time · deposits come back" : now < Number(l.opensAt) ? `funded · opens in ${untilText(l.opensAt, now)}` : stook.opensLate(l, BigInt(now)) ? "opening late · on the live price" : "opening") : l.status === "open" ? (now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : waiting ? (step === "void" ? "no settlement price · can be voided" : `waiting for the settlement price · if none can settle it, void in ${untilText(l.settlesAt + stook.VOID_FALLBACK_SECS, now)}`) : now >= Number(l.settlesAt) ? "the bell is ringing" : `locked · bell in ${untilText(l.settlesAt, now)}`) : l.status === "settled" ? `closed ${l.settledBin! > 0 && l.settledBin! < 63 ? `between ${rangeName(shown, l.settledBin!, l.settledBin!, feed.dp).replace(" to ", " and ")}` : rangeName(shown, l.settledBin!, l.settledBin!, feed.dp)}` : "void";
  const phase: Phase = l.status === "seeding" ? (step === "void" ? "late" : "seeding") : l.status === "open" ? (now < Number(l.locksAt) ? "open" : now < Number(l.settlesAt) ? "locked" : "settling") : l.status === "settled" ? "settled" : "void";

  // ── the floors: the round's bands, centred on its open (or, before it opens, today's price) ──
  const [all, setAll] = useState(false);
  const gridP0 = shown.p0 > 0n ? shown.p0 : live.data?.price ?? 0n;
  const gridExpo = shown.p0 > 0n ? shown.p0Expo : live.data?.expo ?? -8;
  const heldCentres = mine.filter((r) => r.position.shape.h > 1).map((r) => (r.position.shape.lo + r.position.shape.hi) / 2).join(",");
  // The floors drawn only grow during a visit: a refresh never takes one away
  // from under a finger. They start over only if the grid itself moves (a
  // round that has not opened is centred on today's price).
  const span = useRef<{ key: string; lo: number; hi: number } | null>(null);
  const grid = useMemo(() => {
    if (gridP0 <= 0n) return null;
    const p0d = Number(gridP0) * 10 ** gridExpo, step_ = (shown.stepBps || 100) / 10_000;
    const binOfD = (v: number) => Math.max(0, Math.min(63, Math.floor(Math.log(v / p0d) / step_) + 32));
    const key = `${gridP0}|${gridExpo}|${shown.stepBps}`, was = span.current?.key === key ? span.current : null;
    const keep = [32, ...(livePrice !== null ? [binOfD(livePrice)] : []), ...(l.settledBin !== null ? [l.settledBin] : []), ...heldCentres.split(",").filter(Boolean).map(Number), ...(was ? [was.lo, was.hi] : [])];
    const g = makeGrid({ curve: shown.curve, p0: gridP0, expo: gridExpo, stepBps: shown.stepBps || 100, dp: feed.dp, keep, all });
    if (!all) span.current = { key, lo: g.flo, hi: g.fhi };
    return g;
  }, [shown.curve, gridP0, gridExpo, shown.stepBps, feed.dp, livePrice, l.settledBin, heldCentres, all]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the call on the tower, and the one order for it ──
  const desk = useDesk(grid);
  const [selected, setSelected] = useState<string | null>(null);
  // A call that was never placed means nothing once trading closes: it is not drawn or quoted.
  const shape = tradeable && !desk.pending && desk.call ? toShape(desk.call) : null;
  const order = useCallOrder({ refs, ladder: shown, shape, transferFee: mint?.report.transferFee, now, usd, positions: mine });
  const sel = mine.find((r) => r.pubkey.toBase58() === selected) ?? null;
  // A held call edited on the tower is a new call.
  useEffect(() => { if (tradeable && sel && !sameShape(shape, sel.position.shape)) setSelected(null); }, [shape?.lo, shape?.hi, shape?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  // Add more or Sell on a held call; a newly picked call opens on Sell.
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [tab, setTab] = useState<SideTab>("trade");
  const pick = (key: string | null) => {
    const r = key ? mine.find((x) => x.pubkey.toBase58() === key) : null;
    setSide("sell");
    if (!r || key === selected) { setSelected(null); if (tradeable) desk.load(null); return; }
    setSelected(key); if (tradeable) desk.load(fromShape(r.position.shape));
  };
  const pickRef = useRef(pick); pickRef.current = pick;
  const onHeld = useCallback((key: string) => pickRef.current(key), []);
  // A held call on the tower pays what its own shares pay, not a pretend buy from the spend box.
  const heldWin = useMemo(() => {
    if (!sel || !sameShape(shape, sel.position.shape)) return null;
    const p = sel.position, fee = mint?.report.transferFee, at = (lv: number) => stook.netOf(p.shares * BigInt(lv), fee);
    const toWin = at(p.shape.h);
    return { toWin, mult: p.netPaid > 0n ? Number(toWin) / Number(p.netPaid) : null, at, stale: false, held: true };
  }, [sel, shape?.lo, shape?.hi, shape?.h, mint?.report.transferFee]); // eslint-disable-line react-hooks/exhaustive-deps
  const buyWin = useMemo(() => ({ toWin: order.toWin, mult: order.mult, at: order.at, stale: order.stale, held: false }), [order.toWin, order.mult, order.at, order.stale]);
  const held = useMemo(() => mine.filter((r) => r.position.shares > 0n).map((r) => ({ key: r.pubkey.toBase58(), shape: r.position.shape, label: grid ? callName(grid, r.position.shape) : "", sel: r.pubkey.toBase58() === selected })),
    [positions.data, selected, grid]); // eslint-disable-line react-hooks/exhaustive-deps
  // A sensible call is already placed: "Pretty sure" around the price now.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !tradeable || !grid || livePrice === null || desk.call || selected) return;
    seeded.current = true;
    desk.load(nearAt(grid, grid.binOf(livePrice), 3));
  }, [tradeable, grid, livePrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the guide: four short steps, once, while trading is open ──
  const [coach, setCoach] = useState(0);
  const coached = useRef(false);
  useEffect(() => { if (!coached.current && tradeable && grid) { coached.current = true; if (!guideDone()) setCoach(1); } }, [tradeable, !!grid]); // eslint-disable-line react-hooks/exhaustive-deps
  const goCoach = (n: number) => { setCoach(n); if (!n) markGuideDone(); };
  useEffect(() => { if (order.send.isSuccess && coach) goCoach(0); }, [order.send.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  // How sure is only for a call near a price: a range has nothing to pick there.
  useEffect(() => { if (coach === 3 && desk.kind === "between") goCoach(4); }, [coach, desk.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const bal = order.balance.data;
  const walletState: WalletState = !publicKey ? "none" : FAUCET_AUTHORITY_BYTES && bal !== undefined && (bal === 0n || order.short) ? "empty" : "ready";
  const heldAny = (positions.data ?? []).some((r) => r.position.shares > 0n);
  const narrow = useNarrow();
  // The tower's clock moves in steps; the bell counts down on its own.
  const towerNow = now - (now % 15);

  const money = useCallback((u: bigint) => coinText(u, l.decimals, quoteSymbol), [l.decimals, quoteSymbol]);
  const short = useCallback((u: bigint) => fmtCompact(u, l.decimals), [l.decimals]);
  const coachRef = useRef(coach); coachRef.current = coach;
  const onPicked = useCallback(() => { if (coachRef.current === 1) goCoach(2); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (s: stook.Shape) => (grid ? callName(grid, s) : `${s.lo} to ${s.hi}`);
  const slipName = (s: stook.Shape) => (grid ? callShort(grid, s) : `${s.lo} to ${s.hi}`);
  const toTicket = () => { const el = document.getElementById("ticket"); el?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); el?.querySelector<HTMLButtonElement>("button.primary")?.focus({ preventScroll: true }); };
  // Settled: where it closed, and what your calls collect there.
  const closeAt = useMemo(() => {
    if (l.status !== "settled" || l.settledBin === null || !grid) return null;
    const k = l.settledBin, pts = history.data?.points ?? [];
    // The last price at or before the bell, as the tower draws it.
    const near = pts.filter((q) => q[0] <= Number(l.settlesAt) && q[0] >= Number(l.settlesAt) - 600).sort((a, b) => b[0] - a[0])[0];
    if (near && grid.binOf(near[1]) === k) return `at ${grid.fmt(near[1])}`;
    return k === 0 ? `below ${grid.fmt(grid.edge(1))}` : k === 63 ? `above ${grid.fmt(grid.edge(63))}` : `between ${grid.fmt(grid.edge(k))} and ${grid.fmt(grid.edge(k + 1))}`;
  }, [l.status, l.settledBin, l.settlesAt, grid, history.data]);
  const won = l.status === "settled" && l.settledBin !== null ? mine.reduce((a, r) => a + stook.netOf(r.position.shares * BigInt(stook.level(r.position.shape, l.settledBin!)), mint?.report.transferFee), 0n) : 0n;
  const beforeOpen = now < Number(l.opensAt), waitText = waiting ? stateText.replace(/^waiting for the settlement price · /, "") : "";
  const headline: ReactNode = useMemo(() => phase === "seeding" ? (beforeOpen
      ? <>Funded · opens <b>{hm(l.opensAt)}</b> New York. The House takes deposits now; the tower shows the odds it opens with.</>
      : <>Opening in a moment, on the live price. Deposits are open.</>)
    : phase === "late" ? <>This round did not open in time. Deposits come back.</>
    : phase === "locked" ? <>Trading closed. {mine.length ? "Your calls ride to the bell." : "Watch the price ride to the bell."}</>
    : phase === "settling" ? <>The bell rang. {waitText ? `Waiting for the closing price: ${waitText}.` : "The closing price settles it in a moment."}</>
    : phase === "settled" ? <>Closed <b>{closeAt}</b>. {mine.length ? <button className="link" onClick={toTicket}>{won > 0n ? `Collect ${money(won)}` : "See your calls"}</button> : null}</>
    : <>This round was void. Deposits come back first; open calls share the rest. {mine.length || (tranches.data ?? []).length ? <button className="link" onClick={toTicket}>Get your refund</button> : null}</>,
    [phase, beforeOpen, waitText, closeAt, won, mine.length, tranches.data?.length, l.opensAt, money]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the roof: the round's billboard, its LED ticker, and the bell's line ──
  const onHelp = useCallback(() => goCoach(1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const standInShort = coin && standIn ? `Devnet: settles on ${feed.name} (${feed.symbol}) in place of ${coin.anchor.symbol}` : null;
  const sign = useMemo(() => ({
    symbol: feed.symbol, name: feed.name, logo: coin && !standIn ? coin.anchor.logo : undefined,
    coin: coin ? { symbol: coin.symbol, logo: coin.logo } : undefined,
    paidIn: `paid in ${coin ? `$${coin.symbol}` : quoteSymbol}`,
    date: nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric" }),
    closes: `closes ${hm(l.settlesAt)} New York`,
    plaque: standIn && standInShort ? { short: standInShort, full: standIn } : null,
    plaqueNode: coin && !standIn ? <Address label={`${coin.anchor.symbol}`} value={coin.anchor.mint} /> : undefined,
    onHelp: tradeable ? onHelp : null,
  }), [feed.symbol, feed.name, coin, standIn, standInShort, quoteSymbol, l.settlesAt, tradeable, onHelp]);
  const coinAmt = (u: bigint) => `${fmtCompact(u, l.decimals)} ${quoteSymbol}`;
  const ticker = useMemo(() => {
    const out: { k: string; v: string; d?: string; tone?: "up" | "down" }[] = [];
    const px = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: feed.dp, maximumFractionDigits: feed.dp })}`;
    if (livePrice !== null) out.push({ k: "NOW", v: px(livePrice), ...(openPrice !== null ? { d: `${livePrice >= openPrice ? "▲" : "▼"} ${Math.abs((livePrice / openPrice - 1) * 100).toFixed(2)}% since open`, tone: livePrice >= openPrice ? "up" as const : "down" as const } : {}) });
    if (openPrice !== null) out.push({ k: "OPENED", v: `$${fmtPrice(l.p0, l.p0Expo, feed.dp)}`, d: `${nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} New York` });
    else out.push({ k: "OPENS", v: nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" }), d: "New York" });
    out.push({ k: "POOL", v: coinAmt(l.depositTotal), d: usd !== null ? approxUsd(l.depositTotal, l.decimals, usd) : "in the house" });
    out.push({ k: "HOUSE FEES", v: coinAmt(l.feesLp), d: usd !== null ? approxUsd(l.feesLp, l.decimals, usd) : "90% of fees", tone: "up" });
    out.push({ k: "TRADERS IN", v: coinAmt(l.basisTotal), d: usd !== null ? approxUsd(l.basisTotal, l.decimals, usd) : "on open calls" });
    out.push({ k: "EACH FLOOR", v: `${bandUsd !== null ? `$${bandUsd.toLocaleString("en-US", { maximumSignificantDigits: 3 })}` : `${(stepBps / 100).toFixed(2)}%`} tall`, d: `${(stepBps / 100).toFixed(2)}%${preview ? ", set at open" : " of the price"}` });
    return out;
  }, [livePrice, openPrice, l.p0, l.p0Expo, l.opensAt, l.depositTotal, l.feesLp, l.basisTotal, l.decimals, feed.dp, usd, bandUsd, stepBps, preview, quoteSymbol]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = tradeable ? `locks in ${untilText(l.locksAt, now)}` : "";

  return (
    <div className="page market">
      <Title text={`${feed.name} · ${nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric" })}, bell ${hm(l.settlesAt)}`} />
      <div className="tw-layout">
        <section className="tw-main" aria-label={`The tower: ${feed.name}, ${nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric" })}, closes ${hm(l.settlesAt)} New York`}>
          {grid ? <Tower grid={grid} desk={desk} phase={phase} live={livePrice} history={history.data?.points} now={towerNow}
              opened={l.p0 > 0n} opensAt={Number(l.opensAt)} locksAt={Number(l.locksAt)} settlesAt={Number(l.settlesAt)} settledBin={l.status === "settled" ? l.settledBin : null}
              win={heldWin ?? buyWin} money={money} short={short} symbol={quoteSymbol}
              held={held} onHeld={onHeld} wonText={won > 0n ? `YOU WIN · ${fmtCompact(won, l.decimals)}` : null} headline={headline} all={all}
              onPicked={onPicked} sign={sign} ticker={ticker} status={status} />
            : <p className="muted tw-wait">Reading the price…</p>}
        </section>
        <div className="tw-side">
          {/* Desktop: the kind and how sure, level with the tower's top. Phones carry them in the call bar. */}
          {/* Call or House first: the kind and how sure below it only shape a call, so they show under Call only. */}
          <SideSigns tab={tab} setTab={setTab} />
          {!final && grid && tab === "trade" && <fieldset className="tw-ctlset" disabled={!tradeable}>
            <CallKind desk={desk} grid={grid} curve={shown.curve} feeBps={order.feeBps} at={livePrice !== null ? grid.binOf(livePrice) : 32} coarse={coarse || narrow}
              onSure={() => { if (coach === 3) goCoach(4); if (sel) setSelected(null); }} />
          </fieldset>}
          <div id="ticket" className="tw-ticketbox">
            <Ticket refs={refs} ladder={shown} shape={shape} selected={sel} onSelect={(r) => pick(r.pubkey.toBase58())} onDeselect={() => { setSelected(null); desk.load(null); }}
              order={order} name={name} slipName={slipName} side={side} setSide={setSide} exact={grid && tradeable ? <ExactPrices desk={desk} grid={grid} all={all} setAll={setAll} /> : undefined}
              symbol={feed.symbol} coinSymbol={coin?.symbol} dp={feed.dp} quoteSymbol={quoteSymbol} tradeable={tradeable} final={final} positions={mine} tranches={tranches.data ?? []} transferFee={mint?.report.transferFee} now={now} usd={usd} tab={tab} />
          </div>
        </div>
      </div>
      <TowerGuide step={tradeable && grid ? coach : 0} go={goCoach} bell={hm(l.settlesAt)} narrow={narrow} wallet={walletState}
        floorBin={desk.call?.kind === "near" ? desk.call.c : null} />
      {l.status === "settled" && publicKey && heldAny && grid && <AfterBell key={refs.ladder.toBase58()} id={refs.ladder.toBase58()} landed={won > 0n} onCollect={toTicket} />}
      {step === "void" && publicKey && <p className="hint"><button className="link" onClick={() => voidIt.mutate([stook.voidLadderIx(refs, publicKey)])} disabled={voidIt.isPending}>This round cannot finish. Void it: deposits come back first, open calls share the rest</button></p>}
      {/* On Sell the ticket's own button is the action; the bar never offers a buy beside it. */}
      {!final && grid && tab === "trade" && !(sel && side === "sell") && <CallBar order={order} symbol={quoteSymbol} money={money} state={tradeable ? "open" : "closed"} closedText={phase === "late" ? "Not opening. Deposits come back." : l.status === "seeding" ? `Opens ${hm(l.opensAt)} New York.` : `Closed. Bell at ${hm(l.settlesAt)}.`} pending={!!desk.pending} hasCall={!!desk.call} held={!!sel}
        controls={narrow ? <CallKindBar desk={desk} grid={grid} at={livePrice !== null ? grid.binOf(livePrice) : 32} onSure={() => { if (coach === 3) goCoach(4); if (sel) setSelected(null); }} /> : undefined} />}
    </div>
  );
}

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q), on = () => setM(mq.matches); mq.addEventListener("change", on); on(); return () => mq.removeEventListener("change", on); }, [q]);
  return m;
}
const useCoarse = () => useMedia("(pointer: coarse)");
const useNarrow = () => useMedia("(max-width: 980px)");

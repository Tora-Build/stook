// The Board: the street's sharpest callers in each coin, the season race
// across every coin, and how each coin's house has done. Callers come from
// the ledger (infra/ledger, through the site's /leaderboard route): every
// settled round a wallet made a call in. A coin's board ranks by net; the
// all-coins board by season points, week by week to the Friday bell. The
// houses are read from chain. The parts live in components/board/; the
// styles in web/board.css.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { COINS, anchorOf, coinPath, isDevnet, keyOf, type Coin } from "../lib/coins";
import { fmtUsd, toUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { Title } from "../components/Title";
import { BoardHero } from "../components/board/BoardHero";
import { Podium, PodiumSkeleton, Stage } from "../components/board/Podium";
import { Ladder } from "../components/board/Ladder";
import { Houses } from "../components/board/Houses";
import { PERIODS, abs, coinAmt, left, periodName, signOf, tone, useBoard, type Board, type Player, type Score } from "../components/board/data";

/** The all-coins board's periods: the week to the next Friday bell, a past week, the season. */
type Race = "week" | "past" | "season";
const RACES: [Race, string][] = [["week", "This week"], ["past", "Past weeks"], ["season", "Season 0"]];

export function BoardPage() {
  const [coin, setCoin] = useState<Coin | null>(null);
  const [days, setDays] = useState(7);
  const [race, setRace] = useState<Race>("week");
  const [back, setBack] = useState(1);
  const [people, setPeople] = useState(false);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const all = coin === null;
  const q = useBoard(coin, all ? 0 : days, all ? (race === "week" ? 0 : race === "past" ? back : null) : null);
  const rates = useUsdRates().data ?? {};
  const b = q.data;
  const list = b ? (people ? b.peopleBoard : b.board) : [];
  const sym = coin?.symbol ?? null;
  const callTo = coin ? coinPath(coin) : coinPath(COINS[0]!);
  const scored = b?.scoredAt ? nyWhen(b.scoredAt, { hour: "numeric", minute: "2-digit" }) : null;
  const week = b?.week ?? null;
  const score = all ? pointsScore(rates) : netScore(coin, b, rates[coin.symbol] ?? null);
  const when = !all ? (days === 7 ? "in the last 7 days" : days ? `in the last ${days} days` : "so far") : race === "week" ? "this week" : race === "past" ? "that week" : "this season";
  const label = all ? (race === "week" ? "This week" : race === "past" ? (week ? weekName(week) : "Past week") : "Season 0") : periodName(days);

  return (
    <div className="board-page">
      <Title text="The Board" />
      <BoardHero sym={sym} callTo={callTo} players={b ? b.players : null} when={when} />

      <div className="wrap board-body">
        <div className="board-filters">
          <div className="board-coins" role="group" aria-label="Coin">
            <button className={`board-coin board-coin-all ${all ? "on" : ""}`} aria-pressed={all} onClick={() => setCoin(null)}>
              <i className="board-all-ico" aria-hidden="true">★</i><span><b>All coins</b><small>season points</small></span>
            </button>
            {COINS.map((c) => (
              <button key={c.symbol} className={`board-coin ${coin?.symbol === c.symbol ? "on" : ""}`} aria-pressed={coin?.symbol === c.symbol} onClick={() => setCoin(c)}>
                <img src={c.logo} alt="" /><span><b>${c.symbol}</b><small>plays {anchorOf(c).symbol}</small></span>
              </button>
            ))}
          </div>
          <div className="board-filters-r">
            <div className="seg2" role="group" aria-label="Period">
              {all
                ? RACES.map(([r, name]) => <button key={r} className={race === r ? "on" : ""} aria-pressed={race === r} onClick={() => setRace(r)}>{name}</button>)
                : PERIODS.map(([d, name]) => <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{name}</button>)}
            </div>
            {isDevnet && (
              <button className={`board-switch ${people ? "on" : ""}`} role="switch" aria-checked={people} onClick={() => setPeople(!people)} title="The devnet sim runs bot wallets that call every day">
                <i aria-hidden="true" />Hide the sim's bots
              </button>
            )}
          </div>
        </div>

        {all && race === "past" && (
          <div className="board-weeks" role="group" aria-label="Week">
            <button className="btn btn-sm btn-ghost" onClick={() => setBack(back + 1)} disabled={back >= 52} aria-label="An earlier week">‹</button>
            <span>{week ? <>Week to the bell on <b>{nyWhen(week.to, { month: "short", day: "numeric" })}</b></> : "Reading the week"}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setBack(back - 1)} disabled={back <= 1} aria-label="A later week">›</button>
          </div>
        )}

        <Stage
          left={<>{all ? "ALL COINS" : `$${sym}`} · {label}</>}
          mid={all ? (race === "past" ? "THE WEEK'S WINNERS" : "MOST POINTS FIRST") : "BEST NET FIRST"}
          right={all && race === "week" && week ? <Countdown to={week.to} /> : scored ? <>SCORED {scored} NY</> : q.isLoading ? "READING THE LEDGER" : "LEDGER OFFLINE"}>
          {q.isLoading ? <PodiumSkeleton />
            : q.isError || !b ? <Closed onRetry={() => void q.refetch()} busy={q.isFetching} />
            : <>
              <Podium top={list.slice(0, 3)} score={score} me={me} />
              {list.length === 0 && (
                <div className="board-empty">
                  <h3>{people && b.players > 0 ? "Only the sim's bots have called here in this period." : all ? `No settled calls ${when}.` : `No settled calls in $${sym} ${days ? `in the last ${days} days` : "yet"}.`}</h3>
                  {all && race === "past"
                    ? <p>No round settled with a call in it that week, so it has no winners.</p>
                    : <>
                      <p>Three spots are open. Make a call, and when the bell rings at 4 PM New York, your record lands here.</p>
                      <Link className="btn" to={callTo}>Make the first call <span aria-hidden="true">→</span></Link>
                    </>}
                </div>
              )}
            </>}
        </Stage>

        {q.isLoading && <LadderSkeleton />}
        {b && list.length > 0 && <Ladder rows={list.slice(3)} all={list} total={people ? b.people : b.players} score={score} col={all ? "Points" : `Net, $${sym}`} where={all ? "any coin" : `$${sym}`} me={me} callTo={callTo} />}

        {b && (
          <p className="board-foot">
            <b>{b.players}</b> {b.players === 1 ? "caller" : "callers"} in this period{isDevnet ? <>, <b>{b.people}</b> of them people, the rest the devnet sim's bots</> : ""}.
            {all
              ? <>{" "}Each settled round you call in earns 10 points, 30 more when a call paid, and 1 more for each 5% it returned on what you put in, up to 60. Weeks end at the Friday bell, 4 PM New York. {isDevnet ? "Season 0 runs on devnet, and your points are kept by wallet for the mainnet launch." : ""}</>
              : <>{" "}Net is what came back plus what is still to collect, less what went in.</>}
            {" "}Voided rounds and house deposits do not count. Tap a caller to see their rounds.
            {scored ? ` Scored ${scored} New York.` : ""}
            {b.indexed && !b.indexed.complete ? " Older rounds are still being read." : ""}
          </p>
        )}

        <Houses rates={rates} />
      </div>
    </div>
  );
}

/** A coin's board: the net in that coin, its dollars under it. */
function netScore(coin: Coin, b: Board | undefined, rate: number | null) {
  const dec = b?.decimals ?? coin.decimals;
  return (p: Player): Score => {
    const net = BigInt(p.net ?? 0), best = BigInt(p.best ?? 0);
    return { main: coinAmt(net, dec, true), unit: `$${coin.symbol}`, sub: rate !== null ? `≈ ${signOf(net)}${fmtUsd(toUsd(abs(net), dec, rate))}` : undefined, tone: tone(net), title: `Best round ${coinAmt(best, dec, true)} $${coin.symbol} · ${p.points} points` };
  };
}

/** The all-coins board: points, and the nets in each coin summed in dollars where a rate is known. */
function pointsScore(rates: Record<string, number>) {
  const sym = Object.fromEntries(COINS.map((c) => [keyOf(c), c]));
  return (p: Player): Score => {
    let usd = 0, known = false;
    const parts: string[] = [];
    for (const [k, c] of Object.entries(p.coins ?? {})) {
      const coin = sym[k], net = BigInt(c.net), dec = c.decimals ?? coin?.decimals ?? 0, rate = coin ? rates[coin.symbol] : undefined;
      parts.push(`${coinAmt(net, dec, true)} $${coin?.symbol ?? k}`);
      if (rate !== undefined) { usd += (net < 0n ? -1 : 1) * toUsd(abs(net), dec, rate); known = true; }
    }
    return { main: p.points.toLocaleString("en-US"), unit: "pts", sub: known ? `net ≈ ${usd > 0 ? "+" : usd < 0 ? "−" : ""}${fmtUsd(Math.abs(usd))}` : undefined, tone: "board-pts", title: parts.length ? `Net ${parts.join(", ")}` : undefined };
  };
}

/** "Nov 6 to Nov 13": a prize week by its bells. */
const weekName = (w: { from: number; to: number }) => `${nyWhen(w.from, { month: "short", day: "numeric" })} to ${nyWhen(w.to, { month: "short", day: "numeric" })}`;

/** The time left in this week's race, ticking each minute. */
function Countdown({ to }: { to: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  return <>BELL FRI 4 PM NY · {left(to)}</>;
}

/** The ledger did not answer: a shuttered booth and one way back. */
function Closed({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <div className="board-closed">
      <svg className="board-booth" viewBox="0 0 48 40" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="2" y="36" width="44" height="4" fill="#05080f" />
        <rect x="4" y="8" width="40" height="28" fill="#1b2a47" /><rect x="2" y="4" width="44" height="6" fill="#7d2f22" />
        {[4, 12, 20, 28, 36, 42].map((x) => <rect key={x} x={x} y="4" width="3" height="6" fill="#f5eedb" />)}
        <rect x="8" y="14" width="32" height="18" fill="#3a3f4c" />
        {[16, 20, 24, 28].map((y) => <rect key={y} x="8" y={y} width="32" height="1" fill="#22314f" />)}
        <rect x="14" y="18" width="20" height="8" fill="#ffc629" /><rect x="15" y="19" width="18" height="6" fill="#1b1505" />
        <rect x="17" y="21" width="2" height="2" fill="#ffc629" /><rect x="21" y="21" width="2" height="2" fill="#ffc629" /><rect x="25" y="21" width="2" height="2" fill="#ffc629" /><rect x="29" y="21" width="2" height="2" fill="#ffc629" />
      </svg>
      <h3>The board is out of reach right now</h3>
      <p>The ledger did not answer. Your calls and rounds are safe on chain. It will be back shortly.</p>
      <button className="btn btn-sm" onClick={onRetry} disabled={busy}>{busy ? "Trying" : "Try again"}</button>
    </div>
  );
}

function LadderSkeleton() {
  return (
    <section className="board-ladder" aria-hidden="true">
      <ol className="board-rows">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="board-row board-row-sk"><span className="board-sk board-sk-s" /><span className="board-sk board-sk-l" /><span className="board-sk board-sk-s" /></li>)}</ol>
    </section>
  );
}

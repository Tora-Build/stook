// The Board: the street's sharpest callers in each coin, and how each coin's
// house has done. Callers come from the ledger (infra/ledger, through the
// site's /leaderboard route): every settled round a wallet made a call in,
// best net first. The houses are read from chain. The parts live in
// components/board/; the styles in web/board.css.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { COINS, anchorOf, coinPath, isDevnet, type Coin } from "../lib/coins";
import { useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { Title } from "../components/Title";
import { BoardHero } from "../components/board/BoardHero";
import { Podium, PodiumSkeleton, Stage } from "../components/board/Podium";
import { Ladder } from "../components/board/Ladder";
import { Houses } from "../components/board/Houses";
import { PERIODS, periodName, useBoard } from "../components/board/data";

export function BoardPage() {
  const [coin, setCoin] = useState<Coin>(COINS[0]!);
  const [days, setDays] = useState(7);
  const [people, setPeople] = useState(false);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const q = useBoard(coin, days);
  const rates = useUsdRates().data ?? {};
  const rate = rates[coin.symbol] ?? null;
  const b = q.data;
  const dec = b?.decimals ?? coin.decimals;
  const list = b ? (people ? b.peopleBoard : b.board) : [];
  const sym = coin.symbol, callTo = coinPath(coin), period = periodName(days);
  const scored = b?.scoredAt ? nyWhen(b.scoredAt, { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="board-page">
      <Title text="The Board" />
      <BoardHero coin={coin} callTo={callTo} players={b ? b.players : null} days={days} />

      <div className="wrap board-body">
        <div className="board-filters">
          <div className="board-coins" role="group" aria-label="Coin">
            {COINS.map((c) => (
              <button key={c.symbol} className={`board-coin ${coin.symbol === c.symbol ? "on" : ""}`} aria-pressed={coin.symbol === c.symbol} onClick={() => setCoin(c)}>
                <img src={c.logo} alt="" /><span><b>${c.symbol}</b><small>plays {anchorOf(c).symbol}</small></span>
              </button>
            ))}
          </div>
          <div className="board-filters-r">
            <div className="seg2" role="group" aria-label="Period">
              {PERIODS.map(([d, label]) => <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>)}
            </div>
            {isDevnet && (
              <button className={`board-switch ${people ? "on" : ""}`} role="switch" aria-checked={people} onClick={() => setPeople(!people)} title="The devnet sim runs bot wallets that call every day">
                <i aria-hidden="true" />Hide the sim's bots
              </button>
            )}
          </div>
        </div>

        <Stage left={<>${sym} · {period}</>} mid="BEST NET FIRST" right={scored ? <>SCORED {scored} NY</> : q.isLoading ? "READING THE LEDGER" : "LEDGER OFFLINE"}>
          {q.isLoading ? <PodiumSkeleton />
            : q.isError || !b ? <Closed onRetry={() => void q.refetch()} busy={q.isFetching} />
            : <>
              <Podium top={list.slice(0, 3)} sym={sym} dec={dec} rate={rate} me={me} />
              {list.length === 0 && (
                <div className="board-empty">
                  <h3>{people && b.players > 0 ? "Only the sim's bots have called here in this period." : `No settled calls in $${sym} ${days ? `in the last ${days} days` : "yet"}.`}</h3>
                  <p>Three spots are open. Make a call, and when the bell rings at 4 PM New York, your record lands here.</p>
                  <Link className="btn" to={callTo}>Make the first call <span aria-hidden="true">→</span></Link>
                </div>
              )}
            </>}
        </Stage>

        {q.isLoading && <LadderSkeleton />}
        {b && list.length > 0 && <Ladder rows={list.slice(3)} all={list} total={people ? b.people : b.players} sym={sym} dec={dec} rate={rate} me={me} callTo={callTo} />}

        {b && (
          <p className="board-foot">
            <b>{b.players}</b> {b.players === 1 ? "caller" : "callers"} in this period{isDevnet ? <>, <b>{b.people}</b> of them people, the rest the devnet sim's bots</> : ""}.
            {" "}Net is what came back plus what is still to collect, less what went in. Voided rounds and house deposits do not count. Tap a caller to see their rounds.
            {scored ? ` Scored ${scored} New York.` : ""}
            {b.indexed && !b.indexed.complete ? " Older rounds are still being read." : ""}
          </p>
        )}

        <Houses rates={rates} />
      </div>
    </div>
  );
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

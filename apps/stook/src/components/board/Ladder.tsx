// The rest of the board under the podium: one row per caller, clear columns.
// Ranks 4 to 10 show first; the rest fold behind "Show all". The connected
// wallet's row is lit, and while it is still below the screen a copy of it
// sits pinned to the bottom edge, so you can see where you stand. It goes
// away once your real row scrolls into view.
import { useEffect, useRef, useState, type Ref } from "react";
import { Link } from "react-router-dom";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fmtUsd, toUsd } from "../../lib/usd";
import { abs, ago, coinAmt, signOf, shortAddr, tone, type Player } from "./data";
import { Trader } from "./Trader";

/** Rows shown before "Show all": ranks 4 to 10. */
const FOLD = 10;

interface Props { rows: Player[]; all: Player[]; total: number; sym: string; dec: number; rate: number | null; me?: string; callTo: string }

export function Ladder({ rows, all, total, sym, dec, rate, me, callTo }: Props) {
  const mine = me ? all.find((p) => p.wallet === me) : undefined;
  const [open, setOpen] = useState(false);
  const head = open ? rows : rows.filter((p) => p.rank <= FOLD);
  // Folded and you rank below 10: your row still shows, after a gap.
  const extra = !open && mine && mine.rank > FOLD ? mine : undefined;
  const hidden = rows.length - head.length - (extra ? 1 : 0);

  // Pin a copy only while your real row is below the bottom of the screen.
  const youRef = useRef<HTMLLIElement>(null);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const el = youRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setBelow(false); return; }
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      const bottom = e.rootBounds?.bottom ?? window.innerHeight;
      setBelow(!e.isIntersecting && e.boundingClientRect.top >= bottom);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [mine?.wallet, mine?.rank, open]);

  const row = (p: Player) => <Row key={p.wallet} p={p} sym={sym} dec={dec} rate={rate} mine={p.wallet === me} innerRef={p.wallet === me ? youRef : undefined} />;

  return (
    <section className="board-ladder" aria-label={`Callers in $${sym}`}>
      {rows.length > 0 && <>
        <div className="board-row board-row-head" aria-hidden="true">
          <span>#</span><span>Caller</span><span className="board-c-r">Rounds</span><span className="board-c-hit">Hit rate</span><span className="board-c-last">Last round</span><span className="board-c-net">Net, ${sym}</span>
        </div>
        <ol className="board-rows">
          {head.map(row)}
          {extra && <li className="board-gap" aria-hidden="true"><span>···</span></li>}
          {extra && row(extra)}
        </ol>
        {hidden > 0 && (
          <button className="board-more" onClick={() => setOpen(true)}>
            Show all {all.length} <span className="dimmer">· {hidden} more</span>
          </button>
        )}
      </>}
      {mine && mine.rank > 3 && below && <div className="board-pin"><Row p={mine} sym={sym} dec={dec} rate={rate} mine pinned /></div>}
      <Me me={me} on={!!mine} shown={all.length} total={total} sym={sym} callTo={callTo} />
    </section>
  );
}

function Row({ p, sym, dec, rate, mine, pinned, innerRef }: { p: Player; sym: string; dec: number; rate: number | null; mine: boolean; pinned?: boolean; innerRef?: Ref<HTMLLIElement> }) {
  const net = BigInt(p.net), best = BigInt(p.best);
  const won = p.won + p.missed ? (p.won / (p.won + p.missed)) * 100 : 0;
  const cells = <>
    <span className="board-c-rank pix">{p.rank}</span>
    <span className="board-c-who">
      <Trader wallet={p.wallet} size={2} className="board-mini" />
      <span className="board-who-txt">
        <Link to={`/yours?account=${p.wallet}&tab=history`} className="board-addr" title={p.wallet}>{shortAddr(p.wallet)}</Link>
        {mine && <b className="board-you">YOU</b>}
        {p.bot && <span className="board-bot" title="A wallet the devnet sim runs">bot · {p.bot}</span>}
      </span>
    </span>
    <span className="board-c-r num">{p.rounds}<i className="board-ph"> {p.rounds === 1 ? "round" : "rounds"}</i></span>
    <span className="board-c-hit" title={`${p.won} won, ${p.missed} missed`}>
      <b className="num">{Math.round(p.hit * 100)}%</b>
      <span className="board-bar" aria-hidden="true"><i style={{ width: `${won}%` }} /></span>
    </span>
    <span className="board-c-last">{p.last ? ago(p.last) : ""}</span>
    <span className={`board-c-net num ${tone(net)}`} title={`Best round ${coinAmt(best, dec, true)} $${sym}`}>
      {coinAmt(net, dec, true)}
      {rate !== null && <small>≈ {signOf(net)}{fmtUsd(toUsd(abs(net), dec, rate))}</small>}
    </span>
  </>;
  const cls = `board-row ${mine ? "board-row-you" : ""} ${pinned ? "board-row-pinned" : ""}`;
  return pinned ? <div className={cls}>{cells}</div> : <li ref={innerRef} className={cls}>{cells}</li>;
}

/** Where the viewer stands: on the board, below the top of it, not on it yet, or not connected. */
function Me({ me, on, shown, total, sym, callTo }: { me?: string; on: boolean; shown: number; total: number; sym: string; callTo: string }) {
  const modal = useWalletModal();
  if (me && on) return null;
  const cut = total > shown;
  return (
    <div className="board-me">
      <span className="board-me-dot" aria-hidden="true">?</span>
      {!me
        ? <p><b>Looking for yourself?</b> Connect your wallet and your row lights up.</p>
        : cut
          ? <p><b>You are not in the top {shown}.</b> The board shows the best {shown} of {total} callers in this period. If you have not called in ${sym} yet, make a call: when the round settles, your record counts.</p>
          : <p><b>You are not on this board yet.</b> Make a call in ${sym}. When the round settles, your record lands here.</p>}
      {!me
        ? <button className="btn btn-sm btn-ghost" onClick={() => modal.setVisible(true)}>Connect</button>
        : <div className="board-me-act">
          {cut && <Link className="btn btn-sm btn-ghost" to={`/yours?account=${me}&tab=history`}>Your rounds</Link>}
          <Link className="btn btn-sm btn-ghost" to={callTo}>Make a call</Link>
        </div>}
    </div>
  );
}

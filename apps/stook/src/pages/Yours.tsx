// Yours: a brokerage statement from the house on the street. Every round the
// wallet is in, what it put where, what that is worth now or pays, and one
// button per finished round to collect all of it. Amounts stay in each
// round's own coin: $STOOK and $KNOTS do not add up, so they are never summed.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { useHoldings, useMint, useSend } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { ataOf, ensureAta, type Holding } from "../lib/chain";
import { anchorOf, coinByMint } from "../lib/coins";
import { feedByHex, feedHex } from "../lib/feeds";
import { fmtAmount, short } from "../lib/format";
import { bandName, rangeName } from "../components/Ticket";
import { nyWhen } from "../lib/time";

type Stage = "funded" | "opening" | "void soon" | "trading" | "locked" | "settling" | "settled" | "void";

const stageOf = (l: stook.LadderAccount, now: number): Stage =>
  l.status === "settled" ? "settled" : l.status === "void" ? "void"
    : l.status === "seeding" ? (now < Number(l.opensAt) ? "funded" : now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) && now < Number(l.locksAt) ? "opening" : "void soon")
    : now < Number(l.locksAt) ? "trading" : now < Number(l.settlesAt) ? "locked" : "settling";

interface Line { key: string; what: string; size: bigint; cost: bigint; value: bigint | null; kind: "line" | "house"; note?: string }
interface Valued { lines: Line[]; ready: bigint; atWork: bigint; inHouse: bigint }

/** What each thing in a round is worth: paid out if final, sold now if trading. */
function value(h: Holding, now: number, dp: number): Valued {
  const l = h.ladder, final = l.status === "settled" || l.status === "void";
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(now), l.settlesAt);
  const lines: Line[] = [];
  let ready = 0n, atWork = 0n, inHouse = 0n;
  for (const r of h.positions) {
    const p = r.position;
    if (!final && p.shares === 0n) continue;
    const s = p.shape;
    const what = s.h > 1 ? `${bandName(l, Math.floor((s.lo + s.hi) / 2), dp)}, reach ${s.h}` : `${rangeName(l, s.lo, s.hi, dp)} range`;
    let v: bigint | null = null;
    if (final) { v = stook.owedTo(l, p); ready += v > 0n ? v : 0n; }
    else if (l.status === "open" && now < Number(l.locksAt) && p.shares > 0n) {
      try { v = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, s, -p.shares).total; } catch { v = null; }
    }
    if (!final) atWork += p.netPaid;
    lines.push({ key: r.pubkey.toBase58(), kind: "line", what, size: p.shares, cost: p.netPaid, value: v, note: final ? undefined : v === null ? "held to the bell" : "if sold now" });
  }
  for (const r of h.tranches) {
    const t = r.tranche;
    let v: bigint | null = null, note: string | undefined;
    if (l.status === "settled" && l.settledBin !== null) {
      const k = l.settledBin, tt = stook.trancheTerms(l, t);
      v = stook.tranchePrincipal(t.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), l.decimals) + stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap);
      ready += v;
    } else if (l.status === "void") {
      v = stook.voidShare(t.deposit, l.voidLpPot, l.depositTotal); ready += v;
    } else {
      inHouse += t.deposit;
      const tt = stook.trancheTerms(l, t);
      const fees = tt.b > 0n ? stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap) : 0n;
      note = `fees so far ${fmtAmount(fees, l.decimals)} · the rest is settled at the bell`;
    }
    lines.push({ key: r.pubkey.toBase58(), kind: "house", what: `house deposit #${t.index}`, size: t.deposit, cost: t.deposit, value: v, note });
  }
  return { lines, ready, atWork, inHouse };
}

export function Yours() {
  const { publicKey: wallet } = useWallet();
  // `?account=` reads any address's statement, read-only: holdings are public
  // on chain, and only the connected wallet gets collect buttons.
  const [params] = useSearchParams();
  const viewed = useMemo(() => { try { const a = params.get("account"); return a ? new PublicKey(a) : null; } catch { return null; } }, [params]);
  const publicKey = viewed ?? wallet;
  const own = !!wallet && !!publicKey && wallet.equals(publicKey);
  const now = useNow();
  const holdings = useHoldings(publicKey ?? null);
  const rounds = [...(holdings.data ?? [])].sort((a, b) => Number(a.ladder.settlesAt - b.ladder.settlesAt));
  const byCoin = new Map<string, { dec: number; ready: bigint; atWork: bigint; inHouse: bigint }>();
  for (const h of rounds) {
    const c = coinByMint(h.ladder.quoteMint)?.symbol ?? "tokens", v = value(h, now, 2);
    const t = byCoin.get(c) ?? { dec: h.ladder.decimals, ready: 0n, atWork: 0n, inHouse: 0n };
    byCoin.set(c, { dec: t.dec, ready: t.ready + v.ready, atWork: t.atWork + v.atWork, inHouse: t.inHouse + v.inHouse });
  }
  const tote = (pick: (x: { ready: bigint; atWork: bigint; inHouse: bigint }) => bigint) => {
    const rows = [...byCoin.entries()].filter(([, x]) => pick(x) > 0n);
    return rows.length ? rows.map(([c, x]) => <div key={c} className="tote-v mono">{fmtAmount(pick(x), x.dec)} <span className="tote-c">${c}</span></div>) : <div className="tote-v mono muted">0</div>;
  };
  const finished = rounds.filter((h) => { const s = stageOf(h.ladder, now); return s === "settled" || s === "void"; });
  const running = rounds.filter((h) => !finished.includes(h));

  return (
    <div className="page statement">
      <header className="stmt-head">
        <div>
          <div className="stmt-firm">STOOK STREET SECURITIES</div>
          <h1>Statement of account</h1>
        </div>
        <dl className="stmt-meta mono">
          <div><dt>account</dt><dd>{publicKey ? short(publicKey) : "not connected"}{publicKey && !own ? " · read only" : ""}</dd></div>
          <div><dt>as of</dt><dd>{new Date(now * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>
        </dl>
      </header>

      {!publicKey ? <p className="stmt-empty">Connect a wallet to read its statement.</p>
        : holdings.isLoading ? <p className="stmt-empty">Reading the books…</p>
        : rounds.length === 0 ? <p className="stmt-empty">Nothing on the books yet. <Link to="/#floor">Pick a table ›</Link></p>
        : <>
          <section className="tote">
            <div className="tote-cell tote-ready"><div className="tote-k">ready to collect</div>{tote((x) => x.ready)}</div>
            <div className="tote-cell"><div className="tote-k">lines at work</div>{tote((x) => x.atWork)}</div>
            <div className="tote-cell"><div className="tote-k">in the house</div>{tote((x) => x.inHouse)}</div>
          </section>
          {finished.length > 0 && <h2 className="stmt-h">To collect</h2>}
          {finished.map((h) => <RoundBlock key={h.pubkey.toBase58()} h={h} now={now} own={own} />)}
          {running.length > 0 && <h2 className="stmt-h">Running</h2>}
          {running.map((h) => <RoundBlock key={h.pubkey.toBase58()} h={h} now={now} own={own} />)}
          <p className="stmt-foot">Amounts are in each round's coin and before the coin's own transfer fee. A line's worth while trading is what selling it now would pay. Collect what a finished round owes you whenever you like; 30 days after its close, anyone may send it to your wallet for you.</p>
        </>}
    </div>
  );
}

function RoundBlock({ h, now, own }: { h: Holding; now: number; own: boolean }) {
  const { publicKey } = useWallet();
  const l = h.ladder, coin = coinByMint(l.quoteMint), feed = feedByHex(feedHex(l.feedId));
  const mint = useMint(l.quoteMint);
  const send = useSend(l.status === "void" ? "Refunded" : "Collected");
  const stage = stageOf(l, now);
  const dp = coin ? anchorOf(coin).dp : 2;
  const v = value(h, now, dp);
  const collectable = own && (stage === "settled" || stage === "void") && (h.positions.length + h.tranches.length) > 0;
  const collect = async () => {
    if (!publicKey || !mint.data) return;
    const refs = { ladder: h.pubkey, quoteMint: l.quoteMint, tokenProgram: mint.data.tokenProgram };
    const ata = ataOf(l.quoteMint, publicKey, mint.data.tokenProgram);
    const chunks = stook.packByCompute([
      ...h.positions.map((r) => ({ ix: stook.redeemLadderIx(refs, publicKey, ata, r.position.shape), units: stook.REDEEM_COMPUTE_UNITS })),
      ...h.tranches.map((t) => ({ ix: stook.claimLpIx(refs, publicKey, ata, t.tranche.index), units: stook.claimComputeUnits(l, t.tranche) })),
    ]);
    try {
      for (let n = 0; n < chunks.length; n++) await send.mutateAsync({ computeUnits: chunks[n]!.units, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, publicKey, mint.data.tokenProgram)] : []), ...chunks[n]!.ixs] });
    } catch { /* the toast has said why */ }
  };
  const sym = coin ? `$${coin.symbol}` : "";
  // Named by the coin's real anchor, as everywhere but the round page and
  // the fund sheet (which name the devnet stand-in feed, with a note).
  const shownAnchor = coin ? coin.anchor : null;
  const pnl = (x: Line) => (x.value === null ? null : x.value - x.cost);
  return (
    <article className={`stmt-round stage-${stage.replace(" ", "-")}`}>
      <header className="stmt-round-head">
        {coin && <div className="logos"><img src={coin.logo} alt="" className="logo-coin" /><img src={coin.anchor.logo} alt="" className="logo-anchor" /></div>}
        <div className="stmt-round-id">
          <Link to={`/m/${h.pubkey.toBase58()}`} className="stmt-round-name">{shownAnchor ? shownAnchor.name : feed.name} <span className="sym">{shownAnchor ? shownAnchor.symbol : feed.symbol}</span> in {sym}</Link>
          <div className="muted small">closes {nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} New York</div>
        </div>
        <span className={`stamp stamp-${stage.replace(" ", "-")}`}>{stage}</span>
      </header>
      <table className="ledger">
        <thead><tr><th>holding</th><th>size</th><th>cost</th><th>{stage === "settled" || stage === "void" ? "pays" : "worth"}</th><th>result</th></tr></thead>
        <tbody>
          {v.lines.map((x) => { const r = pnl(x); return (
            <tr key={x.key} className={x.kind}>
              <td><span className={`chip-k ${x.kind}`}>{x.kind === "line" ? "LINE" : "HOUSE"}</span> {x.what}{x.note && <div className="ledger-note">{x.note}</div>}</td>
              <td className="mono">{x.kind === "line" ? `${fmtAmount(x.size, l.decimals, 0)} sh` : fmtAmount(x.size, l.decimals)}</td>
              <td className="mono">{fmtAmount(x.cost, l.decimals)}</td>
              <td className="mono">{x.value === null ? "–" : fmtAmount(x.value, l.decimals)}</td>
              <td className={`mono ${r === null ? "muted" : r >= 0n ? "up" : "down"}`}>{r === null ? "at the bell" : `${r >= 0n ? "+" : "−"}${fmtAmount(r >= 0n ? r : -r, l.decimals)}`}</td>
            </tr>); })}
        </tbody>
      </table>
      <footer className="stmt-round-foot">
        {collectable ? <button className="primary" disabled={!publicKey || send.isPending} onClick={() => void collect()}>{send.isPending ? "Collecting…" : `Collect ${fmtAmount(v.ready, l.decimals)} ${sym}`}</button>
          : <Link to={`/m/${h.pubkey.toBase58()}`} className="small as-link">{stage === "trading" ? "To the table ›" : "Open the round ›"}</Link>}
      </footer>
    </article>
  );
}

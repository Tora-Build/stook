import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import { useLadders } from "../hooks/useChain";
import { feedByHex, feedHex } from "../lib/feeds";
import { COINS, coinByMint, feedHexToBytes, mintOf, type Coin } from "../lib/coins";
import { fmtAmount, fmtPrice, fmtWhen, untilText } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { Live } from "../components/Live";
import type { LadderRow } from "../lib/chain";

const ORDER: Record<stook.LadderStatus, number> = { open: 0, seeding: 1, settled: 2, void: 3 };

export function Markets() {
  const ladders = useLadders();
  const now = useNow();
  const rows = [...(ladders.data ?? [])].sort((a, b) => ORDER[a.ladder.status] - ORDER[b.ladder.status] || Number(a.ladder.settlesAt - b.ladder.settlesAt));
  const byCoin = new Map<string, LadderRow[]>();
  const other: LadderRow[] = [];
  for (const r of rows) { const c = coinByMint(r.ladder.quoteMint); if (c) byCoin.set(c.symbol, [...(byCoin.get(c.symbol) ?? []), r]); else other.push(r); }

  return (
    <div className="page">
      <section className="hero">
        <span className="sign">CORNER OF STOOK &amp; WALL</span>
        <h1>Where will it land?</h1>
        <p>Every coin on the street is anchored to a stock. Its rounds ask where that stock lands, in the coin. Draw a line, get paid by how close you were — or be the house. <Link to="/how">How it works</Link></p>
      </section>

      {ladders.isLoading && <p className="muted">Reading the street…</p>}

      {COINS.map((c) => <CoinBlock key={c.symbol} coin={c} rounds={byCoin.get(c.symbol) ?? []} now={now} />)}

      {other.length > 0 && (
        <section className="coin-block">
          <div className="coin-head"><span className="coin-sym muted">TEST ROUNDS</span><span className="muted">devnet USDC, not a street coin</span></div>
          <ul className="cards">{other.map((r) => <RoundCard key={r.pubkey.toBase58()} r={r} now={now} />)}</ul>
        </section>
      )}
    </div>
  );
}

function CoinBlock({ coin, rounds, now }: { coin: Coin; rounds: LadderRow[]; now: number }) {
  const open = rounds.filter((r) => r.ladder.status === "open" || r.ladder.status === "seeding");
  return (
    <section className="coin-block">
      <div className="coin-head">
        <span className="coin-sym">${coin.symbol}</span>
        <span className="coin-anchor">⇢ {coin.anchor.name}{coin.anchor.name !== coin.anchor.symbol && <> <span className="mono">{coin.anchor.symbol}</span></>}</span>
        <span className="muted">{coin.anchor.hours === "24/7" ? "rounds any time" : `settles ${coin.anchor.hours}`} · {coin.feeBps / 100}% transfer fee on the coin</span>
        <AnchorLive coin={coin} />
        {mintOf(coin) ? <Link to={`/new?coin=${coin.symbol}`} className="coin-new">+ round</Link> : <span className="muted small">mint pending</span>}
      </div>
      {open.length === 0 && rounds.length === 0 && <p className="muted small">No rounds yet.</p>}
      <ul className="cards">{rounds.map((r) => <RoundCard key={r.pubkey.toBase58()} r={r} now={now} />)}</ul>
    </section>
  );
}

function AnchorLive({ coin }: { coin: Coin }) {
  // A synthetic "ladder" so <Live> can show the anchor's price with no market yet.
  const fake = { feedId: feedHexToBytes(coin.anchor.feedId), p0: 0n, stepBps: 100 } as unknown as stook.LadderAccount;
  return <span className="coin-live"><Live l={fake} dp={coin.anchor.dp} compact /></span>;
}

function RoundCard({ r: { pubkey, ladder: l }, now }: { r: LadderRow; now: number }) {
  const feed = feedByHex(feedHex(l.feedId));
  const coin = coinByMint(l.quoteMint);
  const unit = coin ? coin.symbol : "USDC";
  const top = l.status === "open" ? (() => { let best = 0, bp = 0n; for (let i = 0; i < 64; i++) { const p = stook.price(l.curve, i); if (p > bp) { bp = p; best = i; } } return { i: best, p: bp }; })() : null;
  return (
    <li>
      <Link to={`/m/${pubkey.toBase58()}`} className={`card card-${l.status}`}>
        <div className="card-head">
          <span className="sym">{feed.symbol}</span>
          <span className={`pill pill-${l.status}`}>{l.status === "open" ? `settles in ${untilText(l.settlesAt, now)}` : l.status === "seeding" ? `opens in ${untilText(l.opensAt, now)}` : l.status}</span>
        </div>
        <div className="card-body">
          <span>{feed.name} at {fmtWhen(l.settlesAt)}</span>
          <Live l={l} dp={feed.dp} compact />
          {l.status === "open" && top && (
            <span className="muted">crowd favours {fmtPrice(stook.binBounds(top.i, l.p0, l.stepBps)[0], l.p0Expo, feed.dp)}–{fmtPrice(stook.binBounds(top.i, l.p0, l.stepBps)[1], l.p0Expo, feed.dp)} ({(Number(top.p) / 1e16).toFixed(0)}%)</span>
          )}
          {l.status === "settled" && l.settledBin !== null && <span className="muted">landed in band {l.settledBin} — {fmtPrice(stook.binBounds(l.settledBin, l.p0, l.stepBps)[0], l.p0Expo, feed.dp)}+</span>}
          <span className="muted mono">pool {fmtAmount(l.depositTotal, l.decimals, 0)} {unit} · {l.stepBps / 100}% bands · fee {l.feeBps / 100}%</span>
        </div>
      </Link>
    </li>
  );
}

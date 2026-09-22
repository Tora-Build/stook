import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import { useLadders } from "../hooks/useChain";
import { feedByHex, feedHex } from "../lib/feeds";
import { fmtAmount, fmtPrice, fmtWhen, untilText } from "../lib/format";
import { useNow } from "../hooks/useNow";

const ORDER: Record<stook.LadderStatus, number> = { open: 0, seeding: 1, settled: 2, void: 3 };

export function Markets() {
  const ladders = useLadders();
  const now = useNow();
  const rows = [...(ladders.data ?? [])].sort((a, b) => ORDER[a.ladder.status] - ORDER[b.ladder.status] || Number(a.ladder.settlesAt - b.ladder.settlesAt));

  return (
    <div className="page">
      <section className="hero">
        <h1>Where will it land?</h1>
        <p>Pick an asset and a time. Draw a line where you think the price will be. The closer you are, the more it pays — and anyone can fund the market that prices it.</p>
      </section>
      {ladders.isLoading && <p className="muted">Reading markets…</p>}
      {ladders.data?.length === 0 && <p className="muted">No markets yet. <Link to="/new">Create the first.</Link></p>}
      <ul className="cards">
        {rows.map(({ pubkey, ladder: l }) => {
          const feed = feedByHex(feedHex(l.feedId));
          const top = l.status === "open" ? (() => { let best = 0, bp = 0n; for (let i = 0; i < 64; i++) { const p = stook.price(l.curve, i); if (p > bp) { bp = p; best = i; } } return { i: best, p: bp }; })() : null;
          return (
            <li key={pubkey.toBase58()}>
              <Link to={`/m/${pubkey.toBase58()}`} className={`card card-${l.status}`}>
                <div className="card-head">
                  <span className="sym">{feed.symbol}</span>
                  <span className={`pill pill-${l.status}`}>{l.status === "open" ? `settles in ${untilText(l.settlesAt, now)}` : l.status === "seeding" ? `opens in ${untilText(l.opensAt, now)}` : l.status}</span>
                </div>
                <div className="card-body">
                  <span>{feed.name} at {fmtWhen(l.settlesAt)}</span>
                  {l.status === "open" && top && (
                    <span className="muted">crowd favours {fmtPrice(stook.binBounds(top.i, l.p0, l.stepBps)[0], l.p0Expo, feed.dp)}–{fmtPrice(stook.binBounds(top.i, l.p0, l.stepBps)[1], l.p0Expo, feed.dp)} ({(Number(top.p) / 1e16).toFixed(0)}%)</span>
                  )}
                  {l.status === "settled" && l.settledBin !== null && <span className="muted">landed in band {l.settledBin} — {fmtPrice(stook.binBounds(l.settledBin, l.p0, l.stepBps)[0], l.p0Expo, feed.dp)}+</span>}
                  <span className="muted mono">depth {fmtAmount(l.depositTotal, l.decimals, 0)} · {l.stepBps / 100}% bands · fee {l.feeBps / 100}%</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

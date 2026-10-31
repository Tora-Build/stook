// Your calls in this round, under the chart: what each cost, what it is worth
// if sold now (or, once trading closes, the most it pays), and Add or Sell.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import type { PositionRow } from "../../lib/chain";
import { coinText, fmtUsd, toUsd } from "../../lib/usd";

export function YourCalls(p: {
  positions: PositionRow[]; ladder: stook.LadderAccount; now: number; transferFee?: stook.TransferFee;
  usd: number | null; quoteSymbol: string; tradeable: boolean;
  name: (s: stook.Shape) => string; selected: string | null; side: "buy" | "sell";
  onPick: (key: string) => void; onSide: (key: string, side: "buy" | "sell") => void;
}) {
  const l = p.ladder, dec = l.decimals;
  const big = (u: bigint) => (p.usd !== null ? fmtUsd(toUsd(u, dec, p.usd)) : coinText(u, dec, p.quoteSymbol));
  // What each would fetch sold now, as it lands in the wallet. Read from the
  // curve; only while trading is open, since that is the only time it sells.
  const fee = stook.feeBpsAt(l.feeBps, BigInt(p.now - (p.now % 60)), l.settlesAt);
  const rows = useMemo(() => p.positions.map((r) => {
    const pos = r.position;
    let worth: bigint | null = null;
    if (p.tradeable && l.b > 0n && pos.shares > 0n) { try { worth = stook.netOf(stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: fee, decimals: dec }, pos.shape, -pos.shares).total, p.transferFee); } catch { worth = null; } }
    const best = stook.netOf(pos.shares * BigInt(pos.shape.h), p.transferFee);
    return { r, key: r.pubkey.toBase58(), worth, best };
  }), [p.positions, p.tradeable, l.curve, l.b, fee, dec, p.transferFee]);
  if (!rows.length) return null;
  const paid = p.positions.reduce((a, r) => a + r.position.netPaid, 0n);
  return (
    <section className="card trade-mine" aria-label="Your calls in this round" data-tour="book">
      <div className="tm-head">
        <h3>Your calls <span className="dimmer">{rows.length} · {big(paid)} in</span></h3>
        <Link to="/yours">All your rounds ›</Link>
      </div>
      <ul>
        {rows.map(({ r, key, worth, best }, n) => {
          const on = key === p.selected, gain = worth !== null ? worth - r.position.netPaid : null;
          return (
            <li key={key} className={on ? "on" : ""}>
              <button className="tm-main" onClick={() => p.onPick(key)} aria-pressed={on} title="Show it on the chart">
                <span className="tm-n">{n + 1}</span>
                <span className="tm-t"><b>{p.name(r.position.shape)}</b><small>Paid {big(r.position.netPaid)}</small></span>
                <span className="tm-r">
                  {gain !== null ? <><b className={gain >= 0n ? "up" : "down"}>{gain >= 0n ? "+" : "−"}{big(gain >= 0n ? gain : -gain)}</b><small>worth {big(worth!)}</small></>
                    : <><b>{big(best)}</b><small>pays up to</small></>}
                </span>
              </button>
              {p.tradeable && <div className="tm-act">
                <button className={`btn btn-sm btn-ghost${on && p.side === "buy" ? " on" : ""}`} onClick={() => p.onSide(key, "buy")}>Add</button>
                <button className={`btn btn-sm btn-ghost${on && p.side === "sell" ? " on" : ""}`} onClick={() => p.onSide(key, "sell")}>Sell</button>
              </div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

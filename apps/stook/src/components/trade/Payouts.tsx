// What each landing pays: one row per level of the call (on your price, one
// row off, …, or inside a range), its chance, a bar as long as what it pays,
// and your stake marked across them, so what wins money and what only
// softens a miss reads at a glance.
import { useMemo } from "react";
import { stook } from "@sooth/sdk-solana";
import { chance } from "../../lib/format";
import type { CallOrder } from "../../hooks/useCallOrder";

const WAD_ONE = 10n ** 18n;

export function Payouts(p: { order: CallOrder; ladder: stook.LadderAccount; money: (u: bigint) => string }) {
  const { shape: s, shares, pays, lands } = p.order;
  const odds = useMemo(() => { if (!s) return []; const [a, z] = stook.shapeBins(s); const m = new Map<number, bigint>(); for (let i = a; i <= z; i++) { const lv = stook.level(s, i); if (lv) m.set(lv, (m.get(lv) ?? 0n) + stook.price(p.ladder.curve, i)); } return [...m.entries()].sort((x, y) => y[0] - x[0]); }, [s, p.ladder.curve]);
  if (!s) return null;
  const rows = odds.map(([lv, pr]) => ({ lv, pr, back: shares ? lands(shares * BigInt(lv)) : 0n }));
  const top = rows.reduce((a, r) => (r.back > a ? r.back : a), 0n);
  const stakeAt = top > 0n && pays ? Math.min(100, (Number(pays) / Number(top)) * 100) : null;
  const rest = WAD_ONE - odds.reduce((a, [, pr]) => a + pr, 0n);
  return (
    <div className="tp" role="table" aria-label="What each landing pays" data-tour="ladder">
      <div className="tp-h" role="row"><span>If it closes</span><span className="tp-scale">{stakeAt !== null && pays !== null && <i style={{ left: `${stakeAt}%` }}>you pay {p.money(pays)}</i>}</span><span>It pays</span></div>
      {rows.map(({ lv, pr, back }) => {
        const win = pays !== null && back >= pays, x = pays && pays > 0n ? Number(back) / Number(pays) : null;
        return (
          <div key={lv} className={`tp-r ${win ? "win" : "soft"}`} role="row">
            <span className="tp-k">{s.h === 1 ? "inside" : lv === s.h ? "on your price" : `${s.h - lv} row${s.h - lv > 1 ? "s" : ""} off`}<small>{chance(pr)} chance</small></span>
            <span className="tp-track"><span className="tp-fill" style={{ width: `${(lv / s.h) * 100}%` }} />{stakeAt !== null && <span className="tp-stake" style={{ left: `${stakeAt}%` }} />}</span>
            <span className="tp-v num">{p.money(back)}{x !== null && <small>{x.toFixed(2)}×</small>}</span>
          </div>
        );
      })}
      <div className="tp-r miss" role="row">
        <span className="tp-k">elsewhere<small>{chance(rest)} chance</small></span>
        <span className="tp-track">{stakeAt !== null && <span className="tp-stake" style={{ left: `${stakeAt}%` }} />}</span>
        <span className="tp-v num">0</span>
      </div>
    </div>
  );
}

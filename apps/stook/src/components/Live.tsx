import { stook } from "@sooth/sdk-solana";
import { useLivePrice } from "../hooks/useChain";
import { fmtPrice } from "../lib/format";

/** The feed's price right now, and where that is relative to the open. */
export function Live({ l, dp, compact }: { l: stook.LadderAccount; dp: number; compact?: boolean }) {
  const live = useLivePrice(l.feedId);
  const p = live.data;
  if (!p || p.price <= 0n) return compact ? null : <span className="muted">live price unavailable</span>;
  const opened = l.p0 > 0n;
  const change = opened ? (Number(p.price) / Number(l.p0) - 1) * 100 : null;
  const bin = opened ? stook.binFor(p.price, l.p0, l.stepBps) : null;
  const age = Math.floor(Date.now() / 1000) - p.publishTime;
  return (
    <span className={`live ${age > 600 ? "live-stale" : ""}`} title={age > 600 ? `Pyth's devnet copy of this feed is ${Math.floor(age / 60)} min old` : "from Pyth"}>
      <span className="mono">${fmtPrice(p.price, p.expo, dp)}</span>
      {change !== null && <span className={`mono ${change >= 0 ? "up" : "down"}`}> {change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>}
      {!compact && bin !== null && <span className="muted"> · would land in band {bin}</span>}
    </span>
  );
}

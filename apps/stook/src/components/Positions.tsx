import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, fmtPrice } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { usePositions, useSend } from "../hooks/useChain";

interface Props { refs: stook.LadderRefs; ladder: stook.LadderAccount; dp: number; quoteSymbol: string; onPick: (s: stook.Shape) => void }

export function Positions(p: Props) {
  const { publicKey } = useWallet();
  const positions = usePositions(p.refs.ladder);
  const redeem = useSend("Redeem");
  const final = p.ladder.status === "settled" || p.ladder.status === "void";
  const rows = (positions.data ?? []).filter((r) => r.position.shares > 0n || final);
  if (!publicKey) return null;

  return (
    <section className="panel">
      <h3>Your positions</h3>
      {rows.length === 0 && <p className="muted">None on this market.</p>}
      <ul className="rows">
        {rows.map(({ pubkey, position: pos }) => {
          const s = pos.shape;
          const [lo] = stook.binBounds(Math.max(s.lo, 0), p.ladder.p0, p.ladder.stepBps);
          const [, hi] = stook.binBounds(Math.min(s.hi, 63), p.ladder.p0, p.ladder.stepBps);
          const owed = p.ladder.status === "settled" && p.ladder.settledBin !== null ? pos.shares * BigInt(stook.level(s, p.ladder.settledBin)) : null;
          return (
            <li key={pubkey.toBase58()}>
              <button className="link" onClick={() => p.onPick(s)}>
                {s.h > 1 ? `line ±${s.h - 1}` : "range"} · {fmtPrice(lo, p.ladder.p0Expo, p.dp)}–{hi === Infinity ? "∞" : fmtPrice(hi, p.ladder.p0Expo, p.dp)}
              </button>
              <span className="mono">{fmtAmount(pos.shares, p.ladder.decimals)} sh · paid {fmtAmount(pos.netPaid, p.ladder.decimals)}</span>
              {final && (
                <button
                  className="small"
                  disabled={redeem.isPending}
                  onClick={() => redeem.mutate([ensureAta(p.ladder.quoteMint, publicKey, p.refs.tokenProgram), stook.redeemLadderIx(p.refs, publicKey, ataOf(p.ladder.quoteMint, publicKey, p.refs.tokenProgram), s)])}
                >
                  {p.ladder.status === "void" ? "Refund" : owed ? `Collect ${fmtAmount(owed, p.ladder.decimals)}` : "Close"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

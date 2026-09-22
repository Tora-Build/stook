import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount, fmtPrice } from "../lib/format";
import { ataOf } from "../lib/chain";
import { useBalance, useSend } from "../hooks/useChain";
import type { DrawMode } from "./Chart";

interface Props {
  refs: stook.LadderRefs;
  ladder: stook.LadderAccount;
  shape: stook.Shape | null;
  mode: DrawMode;
  setMode: (m: DrawMode) => void;
  height: number;
  setHeight: (h: number) => void;
  symbol: string;
  dp: number;
  quoteSymbol: string;
  tradeable: boolean;
}

export function TradePanel(p: Props) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("10");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const send = useSend(side === "buy" ? "Buy" : "Sell");
  const balance = useBalance(p.ladder.quoteMint, p.refs.tokenProgram);
  const dec = p.ladder.decimals;

  const shares = parseAmount(text, dec);
  const quote = useMemo(() => {
    if (!p.shape || !shares || shares <= 0n) return null;
    try {
      return stook.quoteTrade({ curve: p.ladder.curve, b: p.ladder.b, feeBps: p.ladder.feeBps, decimals: dec }, p.shape, side === "buy" ? shares : -shares);
    } catch (e) { return { error: (e as Error).message }; }
  }, [p.shape, shares, side, p.ladder, dec]);
  const q = quote && "total" in quote ? quote : null;

  const [lo, hi] = p.shape ? [stook.binBounds(Math.max(p.shape.lo, 0), p.ladder.p0, p.ladder.stepBps)[0], stook.binBounds(Math.min(p.shape.hi, 63), p.ladder.p0, p.ladder.stepBps)[1]] : [0, 0];
  const centre = p.shape && p.shape.h > 1 ? (p.shape.lo + p.shape.hi) / 2 : null;
  const describe = !p.shape ? null
    : p.shape.h === 1 ? `${p.symbol} between ${fmtPrice(lo, p.ladder.p0Expo, p.dp)} and ${hi === Infinity ? "∞" : fmtPrice(hi, p.ladder.p0Expo, p.dp)}`
    : `${p.symbol} at ${fmtPrice(stook.binBounds(centre!, p.ladder.p0, p.ladder.stepBps)[0], p.ladder.p0Expo, p.dp)}, ±${p.shape.h - 1} band${p.shape.h > 2 ? "s" : ""}`;

  const submit = () => {
    if (!q || !p.shape || !shares || !publicKey) return;
    send.mutate({ computeUnits: stook.tradeComputeUnits(p.shape), ixs: [stook.tradeLadderIx(p.refs, {
      user: publicKey,
      userToken: ataOf(p.ladder.quoteMint, publicKey, p.refs.tokenProgram),
      shape: p.shape,
      shares: side === "buy" ? shares : -shares,
      // The quote IS the program's number; a small allowance covers a trade
      // landing between our read and our send.
      limit: side === "buy" ? (q.total * 1005n) / 1000n : (q.total * 995n) / 1000n,
    })] });
  };

  return (
    <section className="panel">
      <div className="seg">
        <button className={p.mode === "line" ? "on" : ""} onClick={() => p.setMode("line")}>Line</button>
        <button className={p.mode === "range" ? "on" : ""} onClick={() => p.setMode("range")}>Range</button>
        {p.mode === "line" && (
          <label className="height">
            reach
            <input type="range" min={1} max={stook.MAX_HEIGHT} value={p.height} onChange={(e) => p.setHeight(Number(e.target.value))} />
            <span className="mono">{p.height}</span>
          </label>
        )}
      </div>
      <p className="explain">
        {p.mode === "line"
          ? "A line pays most at the band you pick and less at each band away from it. Reach is how far it stretches — and how much the centre pays."
          : "A range pays the same at every band inside it, and nothing outside."}
      </p>

      <div className="shape-desc">{describe ?? <span className="muted">Nothing drawn yet.</span>}</div>

      <div className="seg">
        <button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>Buy</button>
        <button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <label className="field">
        <span>Shares</span>
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" />
        <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"} {p.quoteSymbol}</span>
      </label>

      {quote && "error" in quote && <p className="warn">{quote.error.includes("too large") ? "Too large for this market's depth. Try fewer shares." : quote.error}</p>}
      {q && p.shape && (
        <dl className="quote">
          <div><dt>{side === "buy" ? "You pay" : "You receive"}</dt><dd className="mono">{fmtAmount(q.total, dec)} {p.quoteSymbol}</dd></div>
          <div><dt>fee</dt><dd className="mono">{fmtAmount(q.fee, dec)}</dd></div>
          {side === "buy" && <div><dt>If it lands on your {p.shape.h > 1 ? "line" : "range"}</dt><dd className="mono amber">{fmtAmount(q.maxPayout, dec)} {p.quoteSymbol}</dd></div>}
          {side === "buy" && <div><dt>per share paid</dt><dd className="mono">{(Number(q.total) / Number(shares)).toFixed(3)}</dd></div>}
        </dl>
      )}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey} onClick={submit}>
        {!publicKey ? "Connect a wallet" : !p.tradeable ? "Market closed" : send.isPending ? "Sending…" : side === "buy" ? "Buy" : "Sell"}
      </button>
    </section>
  );
}

export const emptyKey = PublicKey.default;

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount, fmtPrice } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
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
  transferFee?: stook.TransferFee;
}

export function TradePanel(p: Props) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("10");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const send = useSend(side === "buy" ? "Bought" : "Sold");
  const balance = useBalance(p.ladder.quoteMint, p.refs.tokenProgram);
  const l = p.ladder, dec = l.decimals, s = p.shape;

  const shares = parseAmount(text, dec);
  const quote = useMemo(() => {
    if (!s || !shares || shares <= 0n) return null;
    try {
      return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: l.feeBps, decimals: dec }, s, side === "buy" ? shares : -shares);
    } catch (e) { return { error: (e as Error).message }; }
  }, [s, shares, side, l, dec]);
  const q = quote && "total" in quote ? quote : null;

  // How likely the shape is to pay at all, and to pay at each level, by the
  // market's own odds. What a trader needs to compare against the price.
  const odds = useMemo(() => {
    if (!s) return null;
    const [a, z] = stook.shapeBins(s);
    const byLevel = new Map<number, bigint>();
    let any = 0n;
    for (let i = a; i <= z; i++) {
      const lv = stook.level(s, i); if (!lv) continue;
      const pr = stook.price(l.curve, i);
      byLevel.set(lv, (byLevel.get(lv) ?? 0n) + pr); any += pr;
    }
    return { any, byLevel: [...byLevel.entries()].sort((x, y) => y[0] - x[0]) };
  }, [s, l.curve]);

  const priceAt = (i: number) => fmtPrice(stook.binBounds(i, l.p0, l.stepBps)[0], l.p0Expo, p.dp);
  const [lo, hi] = s ? [stook.binBounds(Math.max(s.lo, 0), l.p0, l.stepBps)[0], stook.binBounds(Math.min(s.hi, 63), l.p0, l.stepBps)[1]] : [0, 0];
  const centre = s && s.h > 1 ? (s.lo + s.hi) / 2 : null;
  const describe = !s ? null
    : s.h === 1 ? `${p.symbol} between ${fmtPrice(lo, l.p0Expo, p.dp)} and ${hi === Infinity ? "∞" : fmtPrice(hi, l.p0Expo, p.dp)}`
    : `${p.symbol} near ${priceAt(centre!)}, reach ${s.h}`;

  const submit = () => {
    if (!q || !s || !shares || !publicKey) return;
    send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, {
      user: publicKey,
      userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram),
      shape: s,
      shares: side === "buy" ? shares : -shares,
      // The quote is the program's own number; the allowance covers a trade
      // landing between our read and our send.
      limit: side === "buy" ? (q.total * 1005n) / 1000n : (q.total * 995n) / 1000n,
    })] });
  };

  const perShare = q && shares ? Number(q.total) / Number(shares) : null;
  // A mint that takes a transfer fee: the wallet pays a little more than the
  // quote on a buy, and receives a little less on a sell. The market's books
  // see exactly the quote either way.
  const tf = p.transferFee;
  const wallet = q ? (side === "buy" ? stook.grossFor(q.total, tf) : stook.netOf(q.total, tf)) : null;

  return (
    <section className="panel">
      <div className="seg-row">
        <div className="seg">
          <button className={p.mode === "line" ? "on" : ""} onClick={() => p.setMode("line")}>Line</button>
          <button className={p.mode === "range" ? "on" : ""} onClick={() => p.setMode("range")}>Range</button>
        </div>
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
          ? <>Click the band you expect. Reach is how wide the bet is spread: reach 1 is all on one band; reach {p.height} is a hill over {2 * p.height - 1} bands that pays most at the centre. A wider reach costs more per share, so it does not change what a dollar can win — it changes <b>where</b> it wins.</>
          : <>Drag across a low and a high. Pays the same anywhere inside, nothing outside. The wider the range, the more it costs and the less it returns.</>}
        {" "}<Link to="/how">How it works</Link>
      </p>

      <div className="shape-desc">{describe ?? <span className="muted">Draw on the chart to start.</span>}</div>

      {s && odds && (
        <table className="ladder-table">
          <thead><tr><th>If it lands</th><th>chance</th><th>you get back</th><th>on your stake</th></tr></thead>
          <tbody>
            {odds.byLevel.map(([lv, pr]) => {
              const back = shares ? shares * BigInt(lv) : 0n;
              const x = q && side === "buy" && q.total > 0n ? Number(back) / Number(q.total) : null;
              return (
                <tr key={lv}>
                  <td>{s.h === 1 ? "inside the range" : lv === s.h ? "on your band" : `${s.h - lv} band${s.h - lv > 1 ? "s" : ""} off`}</td>
                  <td className="mono">{(Number(pr) / 1e16).toFixed(1)}%</td>
                  <td className="mono">{shares ? fmtAmount(back, dec) : `${lv}×`}</td>
                  <td className={`mono ${x !== null && x < 1 ? "down" : "amber"}`}>{x !== null ? `${x.toFixed(2)}×` : ""}</td>
                </tr>
              );
            })}
            <tr className="muted"><td>anywhere else</td><td className="mono">{(100 - Number(odds.any) / 1e16).toFixed(1)}%</td><td className="mono">0</td><td className="mono">0×</td></tr>
          </tbody>
        </table>
      )}
      {q && side === "buy" && odds && (() => { const best = shares ? Number(shares * BigInt(s!.h)) / Number(q.total) : 0; return best <= 1.02 ? <p className="warn">This shape pays back about what it costs even when it lands. Narrow it, or pick a band the crowd doubts.</p> : null; })()}

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
      {q && s && (
        <dl className="quote">
          <div><dt>{side === "buy" ? "You pay" : "You receive"}</dt><dd className="mono">{fmtAmount(wallet!, dec)} {p.quoteSymbol}</dd></div>
          {tf && <div><dt>of which the token's own {(tf.bps / 100).toFixed(1)}% transfer fee</dt><dd className="mono">{fmtAmount(side === "buy" ? wallet! - q.total : q.total - wallet!, dec)}</dd></div>}
          <div><dt>per share (fee included)</dt><dd className="mono">{perShare!.toFixed(3)}</dd></div>
          {side === "buy" && <div><dt>best case</dt><dd className="mono amber">{fmtAmount(q.maxPayout, dec)} {p.quoteSymbol} ({(Number(q.maxPayout) / Number(q.total)).toFixed(1)}×)</dd></div>}
        </dl>
      )}
      {side === "buy" && wallet !== null && balance.data !== undefined && balance.data < wallet && <p className="warn">You hold {fmtAmount(balance.data, dec)} {p.quoteSymbol}; this costs {fmtAmount(wallet, dec)}. On devnet, use <b>Get test coins</b> in the header.</p>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey || (side === "buy" && wallet !== null && balance.data !== undefined && balance.data < wallet)} onClick={submit}>
        {!publicKey ? "Connect a wallet" : !p.tradeable ? "Market closed" : send.isPending ? "Sending…" : side === "buy" ? `Buy ${text} shares` : `Sell ${text} shares`}
      </button>
    </section>
  );
}

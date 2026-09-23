// The ticket: the one panel beside the chart. What it offers follows what
// was clicked — an empty price (buy a new line), one of your lines (sell it,
// or collect it after the bell) — and the House tab is the same ticket for
// depositors. After the bell one button collects everything you have in the
// round, in one transaction.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { chance, fmtAmount, parseAmount, fmtPrice } from "../lib/format";

const WAD_ONE = 10n ** 18n;

/** A band by what it covers: its floor, or "below …" / "above …" for the two open-ended tails. */
function bandName(l: stook.LadderAccount, i: number, dp: number): string {
  const [lo, hi] = stook.binBounds(Math.min(Math.max(i, 0), 63), l.p0, l.stepBps);
  if (i <= 0) return `below ${fmtPrice(hi, l.p0Expo, dp)}`;
  if (i >= 63) return `above ${fmtPrice(lo, l.p0Expo, dp)}`;
  return fmtPrice(lo, l.p0Expo, dp);
}

/** How far a band is from the opening price, as a move: "17% below the open". */
function moveFromOpen(l: stook.LadderAccount, i: number): string {
  const [lo, hi] = stook.binBounds(Math.min(Math.max(i, 0), 63), l.p0, l.stepBps);
  const mid = i <= 0 ? hi : i >= 63 ? lo : Math.sqrt(lo * hi), m = (mid / Number(l.p0) - 1) * 100;
  return Math.abs(m) < 0.05 ? "at the open" : `${Math.abs(m).toFixed(Math.abs(m) < 10 ? 1 : 0)}% ${m < 0 ? "below" : "above"} the open${i <= 0 || i >= 63 ? " or further" : ""}`;
}
import { ataOf, ensureAta, type PositionRow, type TrancheRow } from "../lib/chain";
import { useBalance, useSend } from "../hooks/useChain";
import type { DrawMode } from "./Chart";
import { LpPanel } from "./LpPanel";

interface Props {
  refs: stook.LadderRefs;
  ladder: stook.LadderAccount;
  shape: stook.Shape | null;
  selected: PositionRow | null;
  onSelect: (r: PositionRow) => void;
  onDeselect: () => void;
  mode: DrawMode; setMode: (m: DrawMode) => void;
  height: number; setHeight: (h: number) => void;
  symbol: string; dp: number; quoteSymbol: string;
  tradeable: boolean; final: boolean;
  positions: PositionRow[]; tranches: TrancheRow[];
  transferFee?: stook.TransferFee;
  now: number;
}

export function Ticket(p: Props) {
  const [tab, setTab] = useState<"trade" | "house">("trade");
  return (
    <section className="panel ticket">
      <div className="seg ticket-tabs">
        <button className={tab === "trade" ? "on" : ""} onClick={() => setTab("trade")}>Trade</button>
        <button className={tab === "house" ? "on" : ""} onClick={() => setTab("house")}>House</button>
      </div>
      {tab === "house" ? <LpPanel refs={p.refs} ladder={p.ladder} quoteSymbol={p.quoteSymbol} now={p.now} transferFee={p.transferFee} bare /> : p.final ? <Collect {...p} /> : (
        <>
          {p.positions.length > 0 && <Mine {...p} />}
          {p.selected ? <Held {...p} pos={p.selected} /> : <Buy {...p} />}
        </>
      )}
    </section>
  );
}

// ── your lines in this round, as chips: pick one to add to it or sell it ─────
function Mine(p: Props) {
  const dec = p.ladder.decimals, l = p.ladder;
  const name = (s: stook.Shape) => s.h > 1 ? `${bandName(l, (s.lo + s.hi) / 2, p.dp)} ·${s.h}` : `${bandName(l, Math.max(s.lo, 0), p.dp)}–${stook.binBounds(Math.min(s.hi, 63), l.p0, l.stepBps)[1] === Infinity ? "∞" : fmtPrice(stook.binBounds(Math.min(s.hi, 63), l.p0, l.stepBps)[1], l.p0Expo, p.dp)}`;
  return (
    <div className="mine">
      <span className="mine-k">yours</span>
      {p.positions.map((r) => { const on = p.selected?.pubkey.equals(r.pubkey); return <button key={r.pubkey.toBase58()} className={`chip ${on ? "on" : ""}`} onClick={() => (on ? p.onDeselect() : p.onSelect(r))}>{name(r.position.shape)} <span className="mono">{fmtAmount(r.position.shares, dec, 0)} sh</span></button>; })}
    </div>
  );
}

// ── one of your lines: add to it, or sell some of it ─────────────────────────
function Held(p: Props & { pos: PositionRow }) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const pos = p.pos.position, s = pos.shape, dec = p.ladder.decimals;
  return (
    <>
      <div className="shape-desc">Your {s.h > 1 ? `line, reach ${s.h}` : "range"} · {fmtAmount(pos.shares, dec)} shares · paid {fmtAmount(pos.netPaid, dec)} <button className="link" onClick={p.onDeselect}>· draw a new one</button></div>
      <div className="seg held-side"><button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>Buy more</button><button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>Sell</button></div>
      {side === "buy" ? <Buy {...p} shape={s} held /> : <Sell {...p} pos={p.pos} />}
    </>
  );
}

// ── buy a line: a new one, or (`held`) more of one you already hold ──────────
function Buy(p: Props & { held?: boolean }) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("10");
  const send = useSend("Bought");
  const balance = useBalance(p.ladder.quoteMint, p.refs.tokenProgram);
  const l = p.ladder, dec = l.decimals, s = p.shape;
  const shares = parseAmount(text, dec);
  const q = useMemo(() => { if (!s || !shares || shares <= 0n) return null; try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: l.feeBps, decimals: dec }, s, shares); } catch { return null; } }, [s, shares, l, dec]);
  const odds = useMemo(() => { if (!s) return []; const [a, z] = stook.shapeBins(s); const m = new Map<number, bigint>(); for (let i = a; i <= z; i++) { const lv = stook.level(s, i); if (lv) m.set(lv, (m.get(lv) ?? 0n) + stook.price(l.curve, i)); } return [...m.entries()].sort((x, y) => y[0] - x[0]); }, [s, l.curve]);
  // Wallet numbers, not book numbers: what leaves the wallet includes the
  // coin's transfer fee, and what a payout lands as is net of it again.
  const pays = q ? stook.grossFor(q.total, p.transferFee) : null;
  const lands = (book: bigint) => stook.netOf(book, p.transferFee);
  const limit = q ? (q.total * 1005n) / 1000n : null;
  // Held to what the transaction may take, not the point quote: a balance
  // between the two would pass here and fail on chain.
  const short = limit !== null && balance.data !== undefined && balance.data < stook.grossFor(limit, p.transferFee);
  const centre = s && s.h > 1 ? (s.lo + s.hi) / 2 : null;
  const where = !s ? null : s.h === 1 ? `${fmtPrice(stook.binBounds(Math.max(s.lo, 0), l.p0, l.stepBps)[0], l.p0Expo, p.dp)} – ${stook.binBounds(Math.min(s.hi, 63), l.p0, l.stepBps)[1] === Infinity ? "∞" : fmtPrice(stook.binBounds(Math.min(s.hi, 63), l.p0, l.stepBps)[1], l.p0Expo, p.dp)}` : `${bandName(l, centre!, p.dp)}, reach ${s.h}`;
  const existing = s ? p.positions.find((r) => r.position.shape.lo === s.lo && r.position.shape.hi === s.hi && r.position.shape.h === s.h) : null;
  const submit = () => { if (!q || !s || !shares || !publicKey || limit === null) return; send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares, limit })] }); };

  return (
    <>
      {!p.held && <div className="seg-row">
        <div className="seg"><button className={p.mode === "line" ? "on" : ""} onClick={() => p.setMode("line")}>Line</button><button className={p.mode === "range" ? "on" : ""} onClick={() => p.setMode("range")}>Range</button></div>
        {p.mode === "line" && <label className="height">reach <input type="range" min={1} max={stook.MAX_HEIGHT} value={p.height} onChange={(e) => p.setHeight(Number(e.target.value))} /><span className="mono">{p.height}</span></label>}
      </div>}
      {!s ? <p className="explain">{p.tradeable ? (p.mode === "line" ? "Click the price you expect at the close." : "Drag across the range you expect.") : l.status === "seeding" ? (p.now < Number(l.opensAt) ? `Funded. Trading opens ${new Date(Number(l.opensAt) * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}; the House takes deposits now.` : "Opening in a moment. The keeper is posting the opening price; deposits are open.") : "Trading is closed; the bell is next."} {p.positions.length > 0 && <>Click one of your lines on the chart to add to it or sell it.</>}</p>
        : <div className="shape-desc">{p.symbol} at {where}{existing && !p.held && <span className="muted"> · same as your {fmtAmount(existing.position.shares, dec)} sh line: this adds to it</span>}</div>}
      {s && (
        <table className="ladder-table">
          <thead><tr><th>If it lands</th><th>chance</th><th>you get back</th><th>on stake</th></tr></thead>
          <tbody>
            {odds.map(([lv, pr]) => { const back = shares ? lands(shares * BigInt(lv)) : 0n, x = pays && pays > 0n ? Number(back) / Number(pays) : null; return <tr key={lv}><td>{s.h === 1 ? "inside" : lv === s.h ? "on your band" : `${s.h - lv} off`}</td><td className="mono">{chance(pr)}</td><td className="mono">{fmtAmount(back, dec)}</td><td className={`mono ${x !== null && x < 1 ? "down" : "amber"}`}>{x !== null ? `${x.toFixed(2)}×` : ""}</td></tr>; })}
            <tr className="muted"><td>elsewhere</td><td className="mono">{chance(WAD_ONE - odds.reduce((a, [, pr]) => a + pr, 0n))}</td><td className="mono">0</td><td className="mono">0×</td></tr>
          </tbody>
        </table>
      )}
      {s && s.h > 1 && <p className="hint">A share pays {s.h} on your band and one less per band away. That is the reach, and it is the same wherever you draw. What the crowd charges for it is the last column: the longer the odds, the more on stake.</p>}
      <label className="field"><span>Shares</span><input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" /><span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"} {p.quoteSymbol}</span></label>
      {q && pays !== null && limit !== null && <dl className="quote"><div><dt>You pay</dt><dd className="mono">{fmtAmount(pays, dec)} {p.quoteSymbol}</dd></div>{pays !== q.total && <div><dt>of which the coin's transfer fee</dt><dd className="mono">{fmtAmount(pays - q.total, dec)}</dd></div>}<div><dt>at most, if the odds move first</dt><dd className="mono muted">{fmtAmount(stook.grossFor(limit, p.transferFee), dec)}</dd></div><div><dt>best case</dt><dd className="mono amber">{fmtAmount(lands(q.maxPayout), dec)} ({(Number(lands(q.maxPayout)) / Number(pays)).toLocaleString("en-US", { maximumFractionDigits: 1 })}×)<span className="muted small"> if it closes {moveFromOpen(l, Math.floor((s!.lo + s!.hi) / 2))}</span></dd></div></dl>}
      {short && <p className="warn">You hold {fmtAmount(balance.data!, dec)} {p.quoteSymbol}; this can cost up to {fmtAmount(stook.grossFor(limit!, p.transferFee), dec)}.</p>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey || short} onClick={submit}>{!publicKey ? "Connect a wallet" : !p.tradeable ? "Not trading" : !s ? "Draw a line first" : send.isPending ? "Sending…" : `${p.held || existing ? "Add" : "Buy"} ${text} shares`}</button>
    </>
  );
}

// ── sell one of your lines ───────────────────────────────────────────────────
function Sell(p: Props & { pos: PositionRow }) {
  const { publicKey } = useWallet();
  const [pct, setPct] = useState(100);
  const send = useSend("Sold");
  const l = p.ladder, dec = l.decimals, pos = p.pos.position, s = pos.shape;
  const size = (pos.shares * BigInt(pct)) / 100n;
  const q = useMemo(() => { if (size <= 0n) return null; try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: l.feeBps, decimals: dec }, s, -size); } catch { return null; } }, [size, l, dec, s]);
  const get = q ? stook.netOf(q.total, p.transferFee) : null;
  const limit = q ? (q.total * 995n) / 1000n : null;
  const paidFor = size > 0n && pos.shares > 0n ? (pos.netPaid * size) / pos.shares : 0n;
  const submit = () => { if (!q || !publicKey || limit === null) return; send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares: -size, limit })] }, { onSuccess: () => { if (pct === 100) p.onDeselect(); } }); };
  return (
    <>
      <label className="height sell-slider">sell <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} /><span className="mono">{pct}% = {fmtAmount(size, dec)} sh</span></label>
      {q && get !== null && limit !== null && <dl className="quote"><div><dt>You receive</dt><dd className="mono">{fmtAmount(get, dec)} {p.quoteSymbol}</dd></div><div><dt>at least, if the odds move first</dt><dd className="mono muted">{fmtAmount(stook.netOf(limit, p.transferFee), dec)}</dd></div><div><dt>you paid for these</dt><dd className="mono">{fmtAmount(paidFor, dec)}</dd></div><div><dt>result</dt><dd className={`mono ${get >= paidFor ? "up" : "down"}`}>{get >= paidFor ? "+" : "−"}{fmtAmount(get >= paidFor ? get - paidFor : paidFor - get, dec)}</dd></div></dl>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey} onClick={submit}>{!p.tradeable ? "Locked until the bell" : send.isPending ? "Sending…" : `Sell ${pct}%`}</button>
    </>
  );
}

// ── after the bell: everything you have here, in one transaction ─────────────
function Collect(p: Props) {
  const { publicKey } = useWallet();
  const send = useSend(p.ladder.status === "void" ? "Refunded" : "Collected");
  const l = p.ladder, dec = l.decimals;
  // Shown as it lands in the wallet: the pool sends the book amount and the
  // coin's transfer fee, if any, comes off on the way.
  const lands = (book: bigint) => stook.netOf(book, p.transferFee);
  // A void pays depositors first, then open lines share what is left.
  const owed = p.positions.map((r) => ({ r, amount: lands(l.status === "settled" && l.settledBin !== null ? r.position.shares * BigInt(stook.level(r.position.shape, l.settledBin)) : l.status === "void" ? stook.voidShare(r.position.netPaid, l.voidTraderPot, l.basisTotal) : 0n) }));
  const lp = p.tranches.map((t) => { const k = l.settledBin; const v = lands(l.status === "settled" && k !== null ? stook.tranchePrincipal(t.tranche.deposit, stook.tranchePnl(t.tranche.b, t.tranche.join.w[k]!, t.tranche.join.sum, l.curve.w[k]!, l.curve.sum), dec) + stook.trancheFees(t.tranche.b, dec, l.accFee, t.tranche.feeSnap) : stook.voidShare(t.tranche.deposit, l.voidLpPot, l.depositTotal)); return { t, v }; });
  const total = owed.reduce((a, x) => a + x.amount, 0n) + lp.reduce((a, x) => a + x.v, 0n);
  const linesPct = l.status === "void" && l.basisTotal > 0n ? (Number(l.voidTraderPot) / Number(l.basisTotal)) * 100 : null;
  const nothing = p.positions.length === 0 && p.tranches.length === 0;
  // A legacy transaction holds about 14 of these; send them twelve at a time.
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const submit = async () => {
    if (!publicKey) return;
    const ata = ataOf(l.quoteMint, publicKey, p.refs.tokenProgram);
    const items = [...p.positions.map((r) => stook.redeemLadderIx(p.refs, publicKey, ata, r.position.shape)), ...p.tranches.map((t) => stook.claimLpIx(p.refs, publicKey, ata, t.tranche.index))];
    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 12) chunks.push(items.slice(i, i + 12));
    try {
      for (let n = 0; n < chunks.length; n++) {
        setProgress([n + 1, chunks.length]);
        await send.mutateAsync({ computeUnits: 60_000 + 20_000 * chunks[n]!.length, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram)] : []), ...chunks[n]!] });
      }
    } catch { /* the toast has said why; what landed stays landed */ } finally { setProgress(null); }
  };
  return (
    <>
      <p className="explain">{l.status === "void" ? `The round was void. Deposits come back in full; open lines share what is left${linesPct !== null && Math.abs(linesPct - 100) >= 0.005 ? `, ${linesPct.toFixed(2)}% of what they cost, because sellers took their gains before the void` : ", at cost"}.` : `The bell rang. Band ${l.settledBin} landed.`}</p>
      {nothing ? <p className="muted">You had nothing in this round.</p> : (
        <ul className="rows">
          {owed.map(({ r, amount }) => <li key={r.pubkey.toBase58()}><span>{r.position.shape.h > 1 ? `line, reach ${r.position.shape.h}` : "range"} · {fmtAmount(r.position.shares, dec)} sh</span><span className={`mono ${amount > 0n ? "up" : "muted"}`}>{amount > 0n ? `+${fmtAmount(amount, dec)}` : "0"}</span></li>)}
          {lp.map(({ t, v }) => <li key={t.pubkey.toBase58()}><span>deposit #{t.tranche.index} · {fmtAmount(t.tranche.deposit, dec)}</span><span className="mono">{fmtAmount(v, dec)}</span></li>)}
        </ul>
      )}
      {!nothing && <button className="primary" disabled={!publicKey || !!progress} onClick={() => void submit()}>{progress ? (progress[1] > 1 ? `Collecting ${progress[0]} of ${progress[1]}…` : "Sending…") : `Collect ${fmtAmount(total, dec)} ${p.quoteSymbol}`}</button>}
      <p className="hint" style={{ marginTop: ".6rem" }}><Link to={`/c/${p.symbol}`}>Back to the calendar</Link></p>
    </>
  );
}

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
import { nyWhen } from "../lib/time";

const WAD_ONE = 10n ** 18n;

/** A band by what it covers: its floor, or "below …" / "above …" for the two open-ended tails. */
export function bandName(l: stook.LadderAccount, i: number, dp: number): string {
  const [lo, hi] = stook.binBounds(Math.min(Math.max(i, 0), 63), l.p0, l.stepBps);
  if (i <= 0) return `below ${fmtPrice(hi, l.p0Expo, dp)}`;
  if (i >= 63) return `above ${fmtPrice(lo, l.p0Expo, dp)}`;
  return fmtPrice(lo, l.p0Expo, dp);
}

/** A range of bands by its ends: "X – Y", or "below Y" / "above X" when it reaches a tail. */
export function rangeName(l: stook.LadderAccount, lo: number, hi: number, dp: number): string {
  const a = Math.min(Math.max(lo, 0), 63), z = Math.min(Math.max(hi, 0), 63);
  const floor = fmtPrice(stook.binBounds(a, l.p0, l.stepBps)[0], l.p0Expo, dp), top = fmtPrice(stook.binBounds(z, l.p0, l.stepBps)[1], l.p0Expo, dp);
  if (a <= 0 && z >= 63) return "anywhere";
  if (a <= 0) return `below ${top}`;
  if (z >= 63) return `above ${floor}`;
  return `${floor} – ${top}`;
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
import { Slider } from "./Slider";
import { Usd, fmtUsd, fromUsd, toUsd } from "../lib/usd";

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
  /** The coin the round is paid in, for the way back to its calendar. */
  coinSymbol?: string;
  tradeable: boolean; final: boolean;
  positions: PositionRow[]; tranches: TrancheRow[];
  transferFee?: stook.TransferFee;
  now: number;
  /** Dollars per whole coin, or null while unknown. */
  usd: number | null;
}

export function Ticket(p: Props) {
  const [tab, setTab] = useState<"trade" | "house">("trade");
  return (
    <section className="panel ticket">
      <div className="big-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "trade"} className={tab === "trade" ? "on" : ""} onClick={() => setTab("trade")}><span>Trade</span><em>draw a line</em></button>
        <button role="tab" aria-selected={tab === "house"} className={tab === "house" ? "on" : ""} onClick={() => setTab("house")} data-tour="house"><span>House</span><em>fund the pool</em></button>
      </div>
      {tab === "house" ? <LpPanel refs={p.refs} ladder={p.ladder} quoteSymbol={p.quoteSymbol} now={p.now} transferFee={p.transferFee} usd={p.usd} bare /> : p.final ? <Collect {...p} /> : (
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
  const name = (s: stook.Shape) => s.h > 1 ? `${bandName(l, (s.lo + s.hi) / 2, p.dp)} ·${s.h}` : rangeName(l, s.lo, s.hi, p.dp);
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
      <div className="shape-desc">Your {s.h > 1 ? `line, reach ${s.h}` : "range"} · {fmtAmount(pos.shares, dec)} shares · paid {fmtAmount(pos.netPaid, dec)} <Usd units={pos.netPaid} decimals={dec} rate={p.usd} /> <button className="link" onClick={p.onDeselect}>· draw a new one</button></div>
      <div className="seg held-side"><button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>Buy more</button><button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>Sell</button></div>
      {side === "buy" ? <Buy {...p} shape={s} held /> : <Sell {...p} pos={p.pos} />}
    </>
  );
}

// ── buy a line: a new one, or (`held`) more of one you already hold ──────────
function Buy(p: Props & { held?: boolean }) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("10");
  // What the number means: shares, or an amount to spend in the coin or in dollars.
  const [unit, setUnit] = useState<"shares" | "coin" | "usd">("shares");
  const send = useSend("Bought");
  const balance = useBalance(p.ladder.quoteMint, p.refs.tokenProgram);
  const l = p.ladder, dec = l.decimals, s = p.shape;
  // The fee rises over the last six hours; quote at the rate this trade lands at.
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(p.now), l.settlesAt);
  const quote = (n: bigint) => { try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: dec }, s!, n); } catch { return null; } };
  // A spend becomes the most shares it buys, the coin's transfer fee included.
  const budget = unit === "shares" ? null : unit === "coin" ? parseAmount(text, dec) : p.usd ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, p.usd) : null;
  const shares = useMemo(() => {
    if (unit === "shares") return parseAmount(text, dec);
    if (!s || !budget || budget <= 0n) return null;
    const cost = (n: bigint) => { const x = quote(n); return x ? stook.grossFor(x.total, p.transferFee) : null; };
    let lo = 0n, hi = budget > 0n ? budget : 1n;
    for (let k = 0; k < 64; k++) { const c = cost(hi); if (c === null || c > budget) break; lo = hi; hi *= 2n; }
    for (let k = 0; k < 64 && hi - lo > 1n; k++) { const mid = (lo + hi) / 2n, c = cost(mid); if (c !== null && c <= budget) lo = mid; else hi = mid; }
    return lo > 0n ? lo : null;
  }, [unit, text, budget, s, l, dec, feeBps, p.transferFee]); // eslint-disable-line react-hooks/exhaustive-deps
  // A spend larger than the round can take on this line buys only what it can.
  const q = useMemo(() => (s && shares && shares > 0n ? quote(shares) : null), [s, shares, l, dec, feeBps]); // eslint-disable-line react-hooks/exhaustive-deps
  const odds = useMemo(() => { if (!s) return []; const [a, z] = stook.shapeBins(s); const m = new Map<number, bigint>(); for (let i = a; i <= z; i++) { const lv = stook.level(s, i); if (lv) m.set(lv, (m.get(lv) ?? 0n) + stook.price(l.curve, i)); } return [...m.entries()].sort((x, y) => y[0] - x[0]); }, [s, l.curve]);
  // Wallet numbers, not book numbers: what leaves the wallet includes the
  // coin's transfer fee, and what a payout lands as is net of it again.
  const pays = q ? stook.grossFor(q.total, p.transferFee) : null;
  const lands = (book: bigint) => stook.netOf(book, p.transferFee);
  // What may leave the wallet at most, the coin's transfer fee included.
  const limit = q ? stook.grossFor((q.total * 1005n) / 1000n, p.transferFee) : null;
  // Held to what the transaction may take, not the point quote: a balance
  // between the two would pass here and fail on chain.
  const short = limit !== null && balance.data !== undefined && balance.data < limit;
  const centre = s && s.h > 1 ? (s.lo + s.hi) / 2 : null;
  const where = !s ? null : s.h === 1 ? rangeName(l, s.lo, s.hi, p.dp) : `${bandName(l, centre!, p.dp)}, reach ${s.h}`;
  const existing = s ? p.positions.find((r) => r.position.shape.lo === s.lo && r.position.shape.hi === s.hi && r.position.shape.h === s.h) : null;
  const submit = () => { if (!q || !s || !shares || !publicKey || limit === null) return; send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares, limit })] }); };

  return (
    <>
      {!p.held && <div className="seg-row">
        <div className="seg" data-tour="shape"><button className={p.mode === "line" ? "on" : ""} onClick={() => p.setMode("line")}>Line</button><button className={p.mode === "range" ? "on" : ""} onClick={() => p.setMode("range")}>Range</button></div>
        {p.mode === "line" && <label className="height" data-tour="reach">reach <Slider min={1} max={stook.MAX_HEIGHT} value={p.height} onChange={p.setHeight} width={110} /><span className="mono">{p.height}</span></label>}
      </div>}
      {!s ? (p.tradeable
        ? <div className="pick-hint"><span className="pick-arrow" aria-hidden="true">◀</span><span><b>Pick your price on the board.</b> {p.mode === "line" ? "Click a band." : "Drag across a range."}{p.positions.length > 0 ? " Or pick one of your lines to add to it or sell it." : ""}</span></div>
        : <p className="explain">{l.status === "seeding" ? (p.now < Number(l.opensAt) ? `Funded. Trading opens ${nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} NY; the House takes deposits now.` : p.now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) ? "Opening in a moment. Deposits are open." : "This round did not open in time and will be void; deposits come back.") : "Trading is closed; the bell is next."}</p>)
        : <div className="shape-desc">{p.symbol} at {where}{existing && !p.held && <span className="muted"> · same as your {fmtAmount(existing.position.shares, dec)} sh line: this adds to it</span>}</div>}
      {s && (
        <table className="ladder-table">
          <thead><tr><th>If it lands</th><th>chance</th><th>you get back</th><th>on stake</th></tr></thead>
          <tbody>
            {odds.map(([lv, pr]) => { const back = shares ? lands(shares * BigInt(lv)) : 0n, x = pays && pays > 0n ? Number(back) / Number(pays) : null; return <tr key={lv}><td>{s.h === 1 ? "inside" : lv === s.h ? "on your band" : `${s.h - lv} off`}</td><td className="mono">{chance(pr)}</td><td className="mono">{fmtAmount(back, dec)}{p.usd !== null && <span className="usd-line">{fmtUsd(toUsd(back, dec, p.usd))}</span>}</td><td className={`mono ${x !== null && x < 1 ? "down" : "amber"}`}>{x !== null ? `${x.toFixed(2)}×` : ""}</td></tr>; })}
            <tr className="muted"><td>elsewhere</td><td className="mono">{chance(WAD_ONE - odds.reduce((a, [, pr]) => a + pr, 0n))}</td><td className="mono">0</td><td className="mono">0×</td></tr>
          </tbody>
        </table>
      )}
      {s && s.h > 1 && <p className="hint">A share pays {s.h} on your band, one less per band away.</p>}
      <div className="field" data-tour="order">
        <div className="amount-head">
          <span>{unit === "shares" ? "Shares" : "Spend"}</span>
          <div className="seg seg-sm" role="group" aria-label="Enter the amount in">
            <button className={unit === "shares" ? "on" : ""} onClick={() => setUnit("shares")}>Shares</button>
            <button className={unit === "coin" ? "on" : ""} onClick={() => setUnit("coin")}>{p.quoteSymbol}</button>
            {p.usd !== null && <button className={unit === "usd" ? "on" : ""} onClick={() => setUnit("usd")}>USD</button>}
          </div>
        </div>
        <div className={`amount-input ${unit === "usd" ? "amount-usd" : ""}`}>
          {unit === "usd" && <span className="amount-sign">$</span>}
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={unit === "shares" ? "Shares" : `Spend in ${unit === "usd" ? "dollars" : p.quoteSymbol}`} />
          {unit === "coin" && <span className="amount-unit">{p.quoteSymbol}</span>}
        </div>
        <span className="hint">{unit !== "shares" && shares ? <>{fmtAmount(shares, dec)} shares · </> : null}balance {balance.data !== undefined ? <>{fmtAmount(balance.data, dec)} {p.quoteSymbol} <Usd units={balance.data} decimals={dec} rate={p.usd} /></> : `… ${p.quoteSymbol}`}</span>
      </div>
      {budget !== null && pays !== null && pays * 100n < budget * 99n && <p className="warn">This round can take about {fmtAmount(pays, dec)} {p.quoteSymbol}{p.usd !== null ? ` (${fmtUsd(toUsd(pays, dec, p.usd))})` : ""} on this line right now, less than you entered. That is what the order below spends.</p>}
      {q && pays !== null && limit !== null && <div className="slip">
        <div className="slip-big"><span className="slip-k">You pay</span><span className="slip-v"><b className="mono">{p.usd !== null ? fmtUsd(toUsd(pays, dec, p.usd)) : fmtAmount(pays, dec)}</b><span className="slip-sub mono">{fmtAmount(pays, dec)} {p.quoteSymbol}</span></span></div>
        <div className="slip-big slip-win"><span className="slip-k">To win, best case</span><span className="slip-v"><b className="mono">{p.usd !== null ? fmtUsd(toUsd(lands(q.maxPayout), dec, p.usd)) : fmtAmount(lands(q.maxPayout), dec)}</b><span className="slip-sub mono">{fmtAmount(lands(q.maxPayout), dec)} {p.quoteSymbol} · {(Number(lands(q.maxPayout)) / Number(pays)).toLocaleString("en-US", { maximumFractionDigits: 1 })}×</span></span></div>
        <p className="slip-note">Best case if it closes {moveFromOpen(l, Math.floor((s!.lo + s!.hi) / 2))}.</p>
        <dl className="quote">
          {pays !== q.total && <div><dt>of which the coin's transfer fee</dt><dd className="mono">{fmtAmount(pays - q.total, dec)} <Usd units={pays - q.total} decimals={dec} rate={p.usd} /></dd></div>}
          <div><dt>fee</dt><dd className="mono">{(feeBps / 100).toFixed(2)}%{feeBps < stook.FEE_PEAK_BPS ? (Number(l.settlesAt) - p.now > 6 * 3600 ? ", rising to 5% over the last 6 hours" : ", rising to 5% by the lock") : ", its highest: the close is near"}</dd></div>
          <div><dt>at most, if the odds move first</dt><dd className="mono muted">{fmtAmount(limit, dec)} <Usd units={limit} decimals={dec} rate={p.usd} /></dd></div>
        </dl>
      </div>}
      {short && <p className="warn">You hold {fmtAmount(balance.data!, dec)} {p.quoteSymbol}; this can cost up to {fmtAmount(limit!, dec)}.</p>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey || short} onClick={submit}>{!publicKey ? "Connect a wallet" : !p.tradeable ? "Not trading" : !s ? "Draw a line first" : send.isPending ? "Sending…" : `${p.held || existing ? "Add" : "Buy"} ${shares ? fmtAmount(shares, dec) : 0} shares${pays !== null && p.usd !== null ? ` · ${fmtUsd(toUsd(pays, dec, p.usd))}` : ""}`}</button>
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
  const q = useMemo(() => { if (size <= 0n) return null; try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps: stook.feeBpsAt(l.feeBps, BigInt(p.now), l.settlesAt), decimals: dec }, s, -size); } catch { return null; } }, [size, l, dec, s, p.now]);
  const get = q ? stook.netOf(q.total, p.transferFee) : null;
  const limit = q ? (q.total * 995n) / 1000n : null;
  const paidFor = size > 0n && pos.shares > 0n ? (pos.netPaid * size) / pos.shares : 0n;
  const submit = () => { if (!q || !publicKey || limit === null) return; send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares: -size, limit })] }, { onSuccess: () => { if (pct === 100) p.onDeselect(); } }); };
  return (
    <>
      <label className="height sell-slider">sell <Slider min={1} max={100} value={pct} onChange={setPct} width={180} /><span className="mono">{pct}% = {fmtAmount(size, dec)} sh</span></label>
      {q && get !== null && limit !== null && <div className="slip">
        <div className="slip-big slip-win"><span className="slip-k">You receive</span><span className="slip-v"><b className="mono">{p.usd !== null ? fmtUsd(toUsd(get, dec, p.usd)) : fmtAmount(get, dec)}</b><span className="slip-sub mono">{fmtAmount(get, dec)} {p.quoteSymbol}</span></span></div>
        <dl className="quote">
          <div><dt>at least, if the odds move first</dt><dd className="mono muted">{fmtAmount(stook.netOf(limit, p.transferFee), dec)} <Usd units={stook.netOf(limit, p.transferFee)} decimals={dec} rate={p.usd} /></dd></div>
          <div><dt>you paid for these</dt><dd className="mono">{fmtAmount(paidFor, dec)} <Usd units={paidFor} decimals={dec} rate={p.usd} /></dd></div>
          <div><dt>result</dt><dd className={`mono ${get >= paidFor ? "up" : "down"}`}>{get >= paidFor ? "+" : "−"}{fmtAmount(get >= paidFor ? get - paidFor : paidFor - get, dec)} {p.usd !== null && <span className="usd">{get >= paidFor ? "+" : "−"}{fmtUsd(toUsd(get >= paidFor ? get - paidFor : paidFor - get, dec, p.usd))}</span>}</dd></div>
        </dl>
      </div>}
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
  const lp = p.tranches.map((t) => { const k = l.settledBin; const tt = stook.trancheTerms(l, t.tranche); const v = lands(l.status === "settled" && k !== null ? stook.tranchePrincipal(t.tranche.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), dec) + stook.trancheFees(tt.b, dec, l.accFee, t.tranche.feeSnap) : stook.voidShare(t.tranche.deposit, l.voidLpPot, l.depositTotal)); return { t, v }; });
  const total = owed.reduce((a, x) => a + x.amount, 0n) + lp.reduce((a, x) => a + x.v, 0n);
  const linesPct = l.status === "void" && l.basisTotal > 0n ? (Number(l.voidTraderPot) / Number(l.basisTotal)) * 100 : null;
  const nothing = p.positions.length === 0 && p.tranches.length === 0;
  // Sent in as few transactions as their compute and size allow.
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const submit = async () => {
    if (!publicKey) return;
    const ata = ataOf(l.quoteMint, publicKey, p.refs.tokenProgram);
    const chunks = stook.packByCompute([
      ...p.positions.map((r) => ({ ix: stook.redeemLadderIx(p.refs, publicKey, ata, r.position.shape), units: stook.REDEEM_COMPUTE_UNITS })),
      ...p.tranches.map((t) => ({ ix: stook.claimLpIx(p.refs, publicKey, ata, t.tranche.index), units: stook.claimComputeUnits(l, t.tranche) })),
    ]);
    try {
      for (let n = 0; n < chunks.length; n++) {
        setProgress([n + 1, chunks.length]);
        await send.mutateAsync({ computeUnits: chunks[n]!.units, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram)] : []), ...chunks[n]!.ixs] });
      }
    } catch { /* the toast has said why; what landed stays landed */ } finally { setProgress(null); }
  };
  return (
    <>
      <p className="explain">{l.status === "void" ? `The round was void. Deposits come back first, up to what was put in; open lines share what is left${linesPct !== null && Math.abs(linesPct - 100) >= 0.005 ? `, ${linesPct.toFixed(2)}% of what they cost, because sellers took their gains before the void` : ", at cost"}.` : `The bell rang. Band ${l.settledBin} landed.`}</p>
      {nothing ? <p className="muted">You had nothing in this round.</p> : (
        <ul className="rows">
          {owed.map(({ r, amount }) => <li key={r.pubkey.toBase58()}><span>{r.position.shape.h > 1 ? `line, reach ${r.position.shape.h}` : "range"} · {fmtAmount(r.position.shares, dec)} sh</span><span className={`mono ${amount > 0n ? "up" : "muted"}`}>{amount > 0n ? `+${fmtAmount(amount, dec)}` : "0"} {amount > 0n && <Usd units={amount} decimals={dec} rate={p.usd} />}</span></li>)}
          {lp.map(({ t, v }) => <li key={t.pubkey.toBase58()}><span>deposit #{t.tranche.index} · {fmtAmount(t.tranche.deposit, dec)}</span><span className="mono">{fmtAmount(v, dec)} <Usd units={v} decimals={dec} rate={p.usd} /></span></li>)}
        </ul>
      )}
      {!nothing && <button className="primary" disabled={!publicKey || !!progress} onClick={() => void submit()}>{progress ? (progress[1] > 1 ? `Collecting ${progress[0]} of ${progress[1]}…` : "Sending…") : `Collect ${fmtAmount(total, dec)} ${p.quoteSymbol}${p.usd !== null ? ` · ${fmtUsd(toUsd(total, dec, p.usd))}` : ""}`}</button>}
      <p className="hint" style={{ marginTop: ".6rem" }}><Link to={p.coinSymbol ? `/c/${p.coinSymbol}` : "/"}>{p.coinSymbol ? "Back to the calendar" : "Back to the street"}</Link></p>
    </>
  );
}

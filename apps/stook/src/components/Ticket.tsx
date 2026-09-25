// The ticket: the one panel beside the chart. What it offers follows what
// was clicked — an empty price (buy a new line), one of your lines (sell it,
// or collect it after the bell) — and the House tab is the same ticket for
// depositors. After the bell one button collects everything you have in the
// round, in one transaction.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { chance, fmtCompact, parseAmount, fmtPrice } from "../lib/format";
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
import { Book } from "./Book";
import { PaperFold } from "./PaperFold";
import { Notice } from "./Notice";
import { Slider } from "./Slider";
import { Amount, approxUsd, coinText, fromUsd } from "../lib/usd";

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
        <button role="tab" aria-selected={tab === "trade"} className={tab === "trade" ? "on" : ""} onClick={() => setTab("trade")}><span>Call</span><em>pick the close</em></button>
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

// ── your calls in this round, as a book: pick one to add to it or sell it ────
function Mine(p: Props) {
  const dec = p.ladder.decimals, l = p.ladder;
  const name = (s: stook.Shape) => s.h > 1 ? `target at ${bandName(l, (s.lo + s.hi) / 2, p.dp)}, reach ${s.h}` : `range ${rangeName(l, s.lo, s.hi, p.dp)}`;
  const paid = p.positions.reduce((a, r) => a + r.position.netPaid, 0n);
  const money = (v: bigint) => <Amount units={v} decimals={dec} symbol={p.quoteSymbol} rate={p.usd} />;
  return (
    <Book tour="book" kind="call" title="Your calls" count={p.positions.length} open={!!p.selected} onFold={p.onDeselect}
      total={<>{coinText(paid, dec, p.quoteSymbol)} in{p.usd !== null && <span className="approx">{approxUsd(paid, dec, p.usd)}</span>}</>}
      rows={p.positions.map((r) => { const on = !!p.selected?.pubkey.equals(r.pubkey); return {
        key: r.pubkey.toBase58(), on, label: name(r.position.shape), sub: on ? "open below: add or sell" : undefined,
        amount: money(r.position.netPaid), onClick: () => (on ? p.onDeselect() : p.onSelect(r)) }; })} />
  );
}

// ── one of your lines: add to it, or sell some of it ─────────────────────────
function Held(p: Props & { pos: PositionRow }) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const s = p.pos.position.shape;
  return (
    <>
      <div className="seg held-side"><button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>Add more</button><button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>Sell</button></div>
      {side === "buy" ? <Buy {...p} shape={s} held /> : <Sell {...p} pos={p.pos} />}
    </>
  );
}

// ── buy a line: a new one, or (`held`) more of one you already hold ──────────
function Buy(p: Props & { held?: boolean }) {
  const { publicKey } = useWallet();
  // The amount is what you spend, in dollars or the coin: shares are the
  // program's unit, not the player's. Dollars first when the coin has a price.
  const [unitPicked, setUnit] = useState<"coin" | "usd" | null>(null);
  const unit = unitPicked ?? (p.usd !== null ? "usd" : "coin");
  const [typed, setText] = useState<string | null>(null);
  const text = typed ?? (unit === "usd" ? "5" : "100");
  // What the number means: shares, or an amount to spend in the coin or in dollars.
  const send = useSend("Call placed");
  const balance = useBalance(p.ladder.quoteMint, p.refs.tokenProgram);
  const l = p.ladder, dec = l.decimals, s = p.shape;
  // The fee rises over the last six hours; quote at the rate this trade lands at.
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(p.now), l.settlesAt);
  const quote = (n: bigint) => { try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: dec }, s!, n); } catch { return null; } };
  // A spend becomes the most shares it buys, the coin's transfer fee included.
  const budget = unit === "coin" ? parseAmount(text, dec) : p.usd ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, p.usd) : null;
  const shares = useMemo(() => {
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
        <div className="seg shape-seg" data-tour="shape">
          <button className={p.mode === "line" ? "on" : ""} onClick={() => p.setMode("line")} title="Pays most on its band, less on each band away"><ShapeIcon kind="line" />Target</button>
          <button className={p.mode === "range" ? "on" : ""} onClick={() => p.setMode("range")} title="Pays the same anywhere inside the range"><ShapeIcon kind="range" />Range</button>
        </div>
        {p.mode === "line" && <label className="height" data-tour="reach">reach <Slider min={1} max={stook.MAX_HEIGHT} value={p.height} onChange={p.setHeight} width={110} /><span className="mono">{p.height}</span></label>}
      </div>}
      {!s ? (p.tradeable
        ? <div className="pick-hint"><span className="pick-arrow" aria-hidden="true">◀</span><span><b>Pick your price on the board.</b> {p.mode === "line" ? "Click a band." : "Drag across a range."}{p.positions.length > 0 ? " Or pick one of your calls to add to it or sell it." : ""}</span></div>
        : <p className="explain">{l.status === "seeding" ? (p.now < Number(l.opensAt) ? `Funded. Trading opens ${nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} NY; the House takes deposits now.` : p.now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) ? "Opening in a moment. Deposits are open." : "This round did not open in time and will be void; deposits come back.") : "Trading is closed; the bell is next."}</p>)
        : null}
      {/* The payout ladder: each row a bar as long as what it pays, tapering
          like the target itself, with your stake marked across all of them,
          so what wins money and what only softens a miss reads at a glance. */}
      {s && (() => {
        const rows = odds.map(([lv, pr]) => ({ lv, pr, back: shares ? lands(shares * BigInt(lv)) : 0n }));
        const top = rows.reduce((a, r) => (r.back > a ? r.back : a), 0n);
        const stakeAt = top > 0n && pays ? Math.min(100, (Number(pays) / Number(top)) * 100) : null;
        const money = (v: bigint) => coinText(v, dec, p.quoteSymbol);
        const rest = WAD_ONE - odds.reduce((a, [, pr]) => a + pr, 0n);
        return (
          <div className="payl" role="table" aria-label="What each landing pays" data-tour="ladder">
            <div className="payl-head" role="row"><span>If it lands</span><span className="payl-scale">bar: what it pays{stakeAt !== null && pays !== null && <i className="payl-tag" style={{ left: `${stakeAt}%` }}>you pay {money(pays)}</i>}</span><span /></div>
            {rows.map(({ lv, pr, back }) => {
              const win = pays !== null && back >= pays, x = pays && pays > 0n ? Number(back) / Number(pays) : null;
              return (
                <div key={lv} className={`payl-row ${win ? "payl-win" : "payl-soft"}`} role="row">
                  <span className="payl-k">{s.h === 1 ? "inside" : lv === s.h ? "on your band" : `${s.h - lv} off`}<em>{chance(pr)} chance</em></span>
                  <span className="payl-track"><span className="payl-fill" style={{ width: `${(lv / s.h) * 100}%` }} />{stakeAt !== null && <span className="payl-stake" style={{ left: `${stakeAt}%` }} />}</span>
                  <span className="payl-v mono">{money(back)}{x !== null && <em>{x.toFixed(2)}×</em>}</span>
                </div>
              );
            })}
            <div className="payl-row payl-miss" role="row">
              <span className="payl-k">elsewhere<em>{chance(rest)} chance</em></span>
              <span className="payl-track">{stakeAt !== null && <span className="payl-stake" style={{ left: `${stakeAt}%` }} />}</span>
              <span className="payl-v mono">0</span>
            </div>
          </div>
        );
      })()}
      <div className="field" data-tour="order">
        <div className="amount-head">
          <span>Spend</span>
          <div className="seg seg-sm" role="group" aria-label="Enter the amount in">
            {p.usd !== null && <button className={unit === "usd" ? "on" : ""} onClick={() => { setUnit("usd"); setText(null); }}>USD</button>}
            <button className={unit === "coin" ? "on" : ""} onClick={() => { setUnit("coin"); setText(null); }}>{p.quoteSymbol}</button>
          </div>
        </div>
        <div className={`amount-input ${unit === "usd" ? "amount-usd" : ""}`}>
          {unit === "usd" && <span className="amount-sign">$</span>}
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={`Spend in ${unit === "usd" ? "dollars" : p.quoteSymbol}`} />
          {unit === "coin" && <span className="amount-unit">{p.quoteSymbol}</span>}
        </div>
        <span className="hint">balance {balance.data !== undefined ? <>{coinText(balance.data, dec, p.quoteSymbol)}{p.usd !== null ? ` · ${approxUsd(balance.data, dec, p.usd)}` : ""}</> : `… ${p.quoteSymbol}`}</span>
      </div>
      {budget !== null && pays !== null && pays * 100n < budget * 99n && <Notice tone="warn" title="Round limit">Only {coinText(pays, dec, p.quoteSymbol)} more fits on this call: its odds are near the most this round can price. The order below uses that.</Notice>}
      {s && q && pays !== null && limit !== null && <div className="ticket-paper" role="group" aria-label="Your order" data-tour="paper">
        <div className="tp-head"><span>{existing && !p.held ? "Adding to your call" : "Your call"}</span><b className="mono">{p.symbol} {s.h === 1 ? `range ${where}` : `target ${where}`}</b></div>
        <div className="tp-row"><span>You pay</span><i /><b className="mono">{coinText(pays, dec, p.quoteSymbol)}{p.usd !== null && <span className="tp-usd">{approxUsd(pays, dec, p.usd)}</span>}</b></div>
        <div className="tp-row tp-small"><span>Fee {(feeBps / 100).toFixed(feeBps % 100 ? 1 : 0)}%{feeBps >= stook.FEE_PEAK_BPS ? ", its highest" : Number(l.settlesAt) - p.now < 6 * 3600 ? ", rising to 5% by the lock" : ""}</span><i /><span className="mono">{coinText(q.fee, dec, p.quoteSymbol)}</span></div>
        <div className="tp-win">
          <div className="tp-win-top"><span>To win</span><em className="mono">{(Number(lands(q.maxPayout)) / Number(pays)).toLocaleString("en-US", { maximumFractionDigits: 1 })}×</em></div>
          <div className="tp-win-amt"><b className="mono">{coinText(lands(q.maxPayout), dec, p.quoteSymbol)}</b>{p.usd !== null && <span className="tp-usd mono">{approxUsd(lands(q.maxPayout), dec, p.usd)}</span>}</div>
          <div className="tp-note">if it closes {moveFromOpen(l, Math.floor((s.lo + s.hi) / 2))}</div>
        </div>
        <PaperFold label="Limits">
          <div className="tp-row"><span>Most it can cost</span><i /><b className="mono">{coinText(limit, dec, p.quoteSymbol)}</b></div>
          {pays !== q.total && <div className="tp-row"><span>Coin's transfer fee</span><i /><b className="mono">{coinText(pays - q.total, dec, p.quoteSymbol)}</b></div>}
        </PaperFold>
      </div>}
      {short && <Notice tone="stop" title={`Not enough ${p.quoteSymbol}`}>You hold {fmtCompact(balance.data!, dec)}; this can cost up to {fmtCompact(limit!, dec)}. On devnet, get <b>test coins</b> in the header.</Notice>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey || short} onClick={submit}>{!publicKey ? "Connect a wallet" : !p.tradeable ? "Not trading" : !s ? "Pick a price first" : send.isPending ? "Sending…" : `${p.held || existing ? "Add to call" : "Place call"}${pays !== null ? ` · ${coinText(pays, dec, p.quoteSymbol)}` : ""}`}</button>
      <p className="house-how"><Link to="/how?step=line">How a call works ›</Link></p>
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
      <label className="height sell-slider">sell <Slider min={1} max={100} value={pct} onChange={setPct} width={180} /><span className="mono">{pct}%</span></label>
      {q && get !== null && limit !== null && <div className="ticket-paper" role="group" aria-label="Your sale">
        <div className="tp-win"><span>You get</span><div className="tp-win-amt"><b className="mono">{coinText(get, dec, p.quoteSymbol)}</b>{p.usd !== null && <span className="tp-usd mono">{approxUsd(get, dec, p.usd)}</span>}</div></div>
        <div className="tp-row"><span>{get >= paidFor ? "Profit" : "Loss"}</span><i /><b className={`mono ${get >= paidFor ? "tp-up" : "tp-down"}`}>{get >= paidFor ? "+" : "−"}{coinText(get >= paidFor ? get - paidFor : paidFor - get, dec, p.quoteSymbol)}</b></div>
        <PaperFold label="Limits">
          <div className="tp-row"><span>At least, if the odds move first</span><i /><b className="mono">{coinText(stook.netOf(limit, p.transferFee), dec, p.quoteSymbol)}</b></div>
        </PaperFold>
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
  const big = (v: bigint) => coinText(v, dec, p.quoteSymbol);
  const money = (v: bigint) => <Amount units={v} decimals={dec} symbol={p.quoteSymbol} rate={p.usd} />;
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
      <p className="explain">{l.status === "void" ? "The round was void: deposits come back first, open calls share the rest." : `The bell rang: it closed between ${rangeName(l, l.settledBin!, l.settledBin!, p.dp).replace(" – ", " and ")}.`}</p>
      {l.status === "void" && <FoldLine label="How the rest is shared">Deposits come back first, up to what was put in. Open calls share what is left{linesPct !== null && Math.abs(linesPct - 100) >= 0.005 ? `: ${linesPct.toFixed(2)}% of what they cost, because sellers took their gains before the void` : ", at cost"}.</FoldLine>}
      {nothing ? <p className="muted">You had nothing in this round.</p> : (
        <Book kind="call" title="To collect" count={owed.length + lp.length} open total={big(total)}
          rows={[
            ...owed.map(({ r, amount }) => ({ key: r.pubkey.toBase58(), label: r.position.shape.h > 1 ? `target, reach ${r.position.shape.h}` : "range", sub: <>paid {big(r.position.netPaid)}</>, amount: amount > 0n ? <span className="up">+{money(amount)}</span> : <span className="muted">0</span> })),
            ...lp.map(({ t, v }) => ({ key: t.pubkey.toBase58(), label: `house deposit #${t.tranche.index}`, sub: <>put in {big(t.tranche.deposit)}</>, amount: money(v) })),
          ]}
          footer={<button className="primary" disabled={!publicKey || !!progress} onClick={() => void submit()}>{progress ? (progress[1] > 1 ? `Collecting ${progress[0]} of ${progress[1]}…` : "Sending…") : `Collect ${big(total)}`}</button>} />
      )}
      <p className="hint" style={{ marginTop: ".6rem" }}><Link to={p.coinSymbol ? `/c/${p.coinSymbol}` : "/"}>{p.coinSymbol ? "Back to the calendar" : "Back to the street"}</Link></p>
    </>
  );
}

/** A line's payout is a peak, a range's a flat block: drawn as five bars. */
function ShapeIcon({ kind }: { kind: "line" | "range" }) {
  const hs = kind === "line" ? [2, 4, 8, 4, 2] : [0, 6, 6, 6, 0];
  return <svg className="shape-icon" viewBox="0 0 19 9" width={25} height={12} aria-hidden="true">{hs.map((h, i) => <rect key={i} x={i * 4} y={9 - h} width={3} height={h} fill="currentColor" />)}</svg>;
}

/** A line of explanation folded until asked for, on the dark panel. */
function FoldLine({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="how-more">
      <button className="how-more-btn" onClick={() => setOpen(!open)} aria-expanded={open}><span className="pb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span> {label}</button>
      {open && <p className="how-more-in explain">{children}</p>}
    </div>
  );
}

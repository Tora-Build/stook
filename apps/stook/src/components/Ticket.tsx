// The ticket: the one panel beside the chart. What it offers follows what
// was clicked — an empty price (buy a new line), one of your lines (sell it,
// or collect it after the bell) — and the House tab is the same ticket for
// depositors. After the bell one button collects everything you have in the
// round, in one transaction.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { chance, fmtCompact, fmtPrice } from "../lib/format";
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
  return `${floor} to ${top}`;
}

/** How far a band is from the opening price, as a move: "17% below the open". */
function moveFromOpen(l: stook.LadderAccount, i: number): string {
  const [lo, hi] = stook.binBounds(Math.min(Math.max(i, 0), 63), l.p0, l.stepBps);
  const mid = i <= 0 ? hi : i >= 63 ? lo : Math.sqrt(lo * hi), m = (mid / Number(l.p0) - 1) * 100;
  return Math.abs(m) < 0.05 ? "at the open" : `${Math.abs(m).toFixed(Math.abs(m) < 10 ? 1 : 0)}% ${m < 0 ? "below" : "above"} the open${i <= 0 || i >= 63 ? " or further" : ""}`;
}
import { ataOf, ensureAta, type PositionRow, type TrancheRow } from "../lib/chain";
import { useMint, useSend } from "../hooks/useChain";
import type { CallOrder } from "../hooks/useCallOrder";
import { LpPanel } from "./LpPanel";
import { Book } from "./Book";
import { Rack } from "./Rack";
import { PaperFold } from "./PaperFold";
import { Notice } from "./Notice";
import { Slider } from "./Slider";
import { Amount, approxUsd, coinText } from "../lib/usd";

interface Props {
  refs: stook.LadderRefs;
  ladder: stook.LadderAccount;
  shape: stook.Shape | null;
  selected: PositionRow | null;
  onSelect: (r: PositionRow) => void;
  onDeselect: () => void;
  /** The one order for the call on the tower (hooks/useCallOrder). */
  order: CallOrder;
  /** Steppers and price fields for the call, folded under "Exact prices". */
  exact?: ReactNode;
  /** A call by name, in the tower's words. */
  name: (s: stook.Shape) => string;
  /** The same, short, for a slip in the rack. */
  slipName?: (s: stook.Shape) => string;
  /** On a held call: Add more or Sell. Kept by the page, so the phone's call bar follows it. */
  side: "buy" | "sell"; setSide: (s: "buy" | "sell") => void;
  symbol: string; dp: number; quoteSymbol: string;
  /** The coin the round is paid in, for the way back to its calendar. */
  coinSymbol?: string;
  tradeable: boolean; final: boolean;
  positions: PositionRow[]; tranches: TrancheRow[];
  transferFee?: stook.TransferFee;
  now: number;
  /** Dollars per whole coin, or null while unknown. */
  usd: number | null;
  /** Call or House, kept by the page: its switch heads the side panel (SideSigns). */
  tab: SideTab;
}

export type SideTab = "trade" | "house";

/** Call or House: two enamel signs on the door, the side you are on lit. They
 *  head the side panel, above the call's own controls, which only a Call uses. */
export function SideSigns({ tab, setTab }: { tab: SideTab; setTab: (t: SideTab) => void }) {
  return (
    <div className="dsigns" role="tablist" aria-label="Call or house">
      <button role="tab" aria-selected={tab === "trade"} className={`dsign ds-call${tab === "trade" ? " on" : ""}`} onClick={() => setTab("trade")} title="Pick the close">
        <i className="screw l" aria-hidden="true" /><i className="screw r" aria-hidden="true" />
        <svg viewBox="0 0 10 8" width="20" height="16" shapeRendering="crispEdges" aria-hidden="true"><rect x="0" y="6" width="2" height="2" fill="currentColor" /><rect x="3" y="3" width="2" height="5" fill="currentColor" /><rect x="6" y="0" width="2" height="8" fill="currentColor" /><rect x="9" y="4" width="1" height="4" fill="currentColor" /></svg>
        <span>Call</span>
      </button>
      <button role="tab" aria-selected={tab === "house"} className={`dsign ds-house${tab === "house" ? " on" : ""}`} onClick={() => setTab("house")} data-tour="house" title="Fund the pool">
        <i className="screw l" aria-hidden="true" /><i className="screw r" aria-hidden="true" />
        <svg viewBox="0 0 10 8" width="20" height="16" shapeRendering="crispEdges" aria-hidden="true"><rect x="1" y="4" width="8" height="4" fill="currentColor" /><rect x="0" y="3" width="10" height="1" fill="currentColor" /><rect x="2" y="0" width="2" height="3" fill="currentColor" /><rect x="6" y="1" width="2" height="2" fill="currentColor" /><rect x="4" y="5" width="2" height="2" fill="var(--ds-bg)" /></svg>
        <span>House</span>
      </button>
    </div>
  );
}

export function Ticket(p: Props) {
  const tab = p.tab;
  return (
    <section className="panel ticket">
      {tab === "house" ? <LpPanel refs={p.refs} ladder={p.ladder} quoteSymbol={p.quoteSymbol} now={p.now} transferFee={p.transferFee} usd={p.usd} bare /> : p.final ? <Collect {...p} /> : (
        <>
          {p.positions.length > 0 && <Mine {...p} />}
          {p.selected ? <Held {...p} pos={p.selected} /> : <Buy {...p} />}
        </>
      )}
    </section>
  );
}

// ── your calls in this round, as a rack of slips: pick one to add to it or sell it ──
function Mine(p: Props) {
  const dec = p.ladder.decimals;
  const paid = p.positions.reduce((a, r) => a + r.position.netPaid, 0n);
  const n = p.positions.length;
  // What a call pays at best: its shares on its best floor, as it lands in the wallet.
  const best = (r: PositionRow) => stook.netOf(r.position.shares * BigInt(r.position.shape.h), p.transferFee);
  return (
    <Rack tour="book" kind="call" title="Your calls" label="Your calls in this round"
      summary={<>{n} call{n === 1 ? "" : "s"} · {coinText(paid, dec, p.quoteSymbol)} in{p.usd !== null && <span className="approx">{approxUsd(paid, dec, p.usd)}</span>}</>}
      slips={p.positions.map((r) => { const on = !!p.selected?.pubkey.equals(r.pubkey); return {
        key: r.pubkey.toBase58(), on, title: (p.slipName ?? p.name)(r.position.shape),
        lines: [{ k: "paid", v: fmtCompact(r.position.netPaid, dec) }, { k: "pays up to", v: fmtCompact(best(r), dec), tone: "up" as const }],
        onClick: () => (on ? p.onDeselect() : p.onSelect(r)),
        actions: <SideStamps side={p.side} setSide={p.setSide} /> }; })}
      more={<Link to="/yours">Every round you are in: your statement ›</Link>} />
  );
}

/** Add more or Sell, as two rubber stamps on the picked slip. */
function SideStamps({ side, setSide }: { side: "buy" | "sell"; setSide: (s: "buy" | "sell") => void }) {
  return (
    <div className="held-side rk-stamps" role="group" aria-label="Add more or sell">
      <button className="rk-stamp st-add" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Add more</button>
      <button className="rk-stamp st-sell" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
    </div>
  );
}

// ── one of your lines: add to it, or sell some of it ─────────────────────────
const hm = (t: number | bigint) => nyWhen(t, { hour: "numeric", minute: "2-digit" });
/** What a trade button says when this round takes no trades now. */
const closedLabel = (l: Props["ladder"], now: number) =>
  l.status === "open" ? `Closed · bell at ${hm(l.settlesAt)}` : l.status === "seeding" && now < Number(l.opensAt) ? `Opens ${hm(l.opensAt)} New York` : "Not trading";

function Held(p: Props & { pos: PositionRow }) {
  // Add more or Sell is picked on the slip itself, in the rack above.
  return p.side === "buy" ? <Buy {...p} shape={p.pos.position.shape} held /> : <Sell {...p} pos={p.pos} />;
}

// ── buy a line: a new one, or (`held`) more of one you already hold ──────────
// The numbers come from the page's one order (hooks/useCallOrder), which the
// tower's WIN tag and the phone's call bar read too.
function Buy(p: Props & { held?: boolean }) {
  const o = p.order;
  const { unit, text, q, pays, limit, rising, short, existing, balance, send, lands, next, feeBps, shares } = o;
  const connected = !!useWallet().publicKey;
  const l = p.ladder, dec = l.decimals, s = o.shape;
  const odds = useMemo(() => { if (!s) return []; const [a, z] = stook.shapeBins(s); const m = new Map<number, bigint>(); for (let i = a; i <= z; i++) { const lv = stook.level(s, i); if (lv) m.set(lv, (m.get(lv) ?? 0n) + stook.price(l.curve, i)); } return [...m.entries()].sort((x, y) => y[0] - x[0]); }, [s, l.curve]);
  const budget = o.budget;

  return (
    <>
      {/* What to do next is said once, on the tower's roof; the ticket only explains a round that takes no calls. */}
      {!p.shape ? (p.tradeable
        ? null
        : <p className="explain">{l.status === "seeding" ? (p.now < Number(l.opensAt) ? `Funded. Trading opens ${nyWhen(l.opensAt, { weekday: "short", hour: "numeric", minute: "2-digit" })} NY; the House takes deposits now.` : p.now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) ? "Opening in a moment. Deposits are open." : "This round did not open in time and will be void; deposits come back.") : `Trading closed at ${hm(l.locksAt)}. The bell rings at ${hm(l.settlesAt)} New York, and the next round opens right after it.`}</p>)
        : null}
      <div className="field" data-tour="order">
        <div className="amount-head">
          <span>Spend</span>
          <div className="seg seg-sm" role="group" aria-label="Enter the amount in">
            {p.usd !== null && <button className={unit === "usd" ? "on" : ""} onClick={() => o.setUnit("usd")}>USD</button>}
            <button className={unit === "coin" ? "on" : ""} onClick={() => o.setUnit("coin")}>{p.quoteSymbol}</button>
          </div>
        </div>
        <div className={`amount-input ${unit === "usd" ? "amount-usd" : ""}`}>
          {unit === "usd" && <span className="amount-sign">$</span>}
          <input value={text} onChange={(e) => o.setText(e.target.value)} inputMode="decimal" aria-label={`Spend in ${unit === "usd" ? "dollars" : p.quoteSymbol}`} />
          {unit === "coin" && <span className="amount-unit">{p.quoteSymbol}</span>}
        </div>
        <span className="hint">{!connected ? "Connect a wallet to see your balance" : <>balance {balance.data !== undefined ? <>{coinText(balance.data, dec, p.quoteSymbol)}{p.usd !== null ? ` · ${approxUsd(balance.data, dec, p.usd)}` : ""}</> : `… ${p.quoteSymbol}`}</>}</span>
      </div>
      {budget !== null && pays !== null && pays * 100n < budget * 99n && <Notice tone="warn" title="Round limit">Only {coinText(pays, dec, p.quoteSymbol)} more fits on this call: its odds are near the most this round can price. The order below uses that.</Notice>}
      {s && q && pays !== null && limit !== null && <div className="ticket-paper" role="group" aria-label="Your order" data-tour="paper">
        <div className="tp-head"><span>{existing && !p.held ? "Adding to your call" : "Your call"}</span><b className="mono">{p.symbol} · {p.name(s)}</b></div>
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
      {s && q && rising && <Notice tone="warn" title="Transfer fee rising">The coin's issuer has set its transfer fee to rise to {next!.bps / 100}%. If that happens before this goes through, it fails and nothing moves.</Notice>}
      {short && <Notice tone="stop" title={`Not enough ${p.quoteSymbol}`}>You hold {fmtCompact(balance.data!, dec)}; this can cost up to {fmtCompact(limit!, dec)}. On devnet, get <b>test coins</b> in the header.</Notice>}
      <button className="primary" data-coach="place" disabled={!q || o.stale || !p.tradeable || send.isPending || !o.connected || short} onClick={o.submit}>{!o.connected ? "Connect a wallet" : !p.tradeable ? closedLabel(l, p.now) : !p.shape ? "Pick a price first" : send.isPending ? "Sending…" : `${p.held || existing ? "Add to call" : "Place call"}${pays !== null ? ` · ${coinText(pays, dec, p.quoteSymbol)}` : ""}`}</button>
      {!p.held && p.exact && <details className="tw-exact">
        <summary>Exact prices</summary>
        {p.exact}
        {/* What each landing pays: a bar as long as what it pays, your stake
            marked across them, so what wins money and what only softens a
            miss reads at a glance. */}
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
                    <span className="payl-k">{s.h === 1 ? "inside" : lv === s.h ? "on your floor" : `${s.h - lv} floor${s.h - lv > 1 ? "s" : ""} off`}<em>{chance(pr)} chance</em></span>
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
      </details>}
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
  // The least that must land in the wallet, the coin's transfer fee in force
  // off: the program holds the sale to what arrives, so a higher fee the
  // issuer has scheduled fails it if it starts first.
  const next = useMint(l.quoteMint).data?.report.nextTransferFee;
  const limit = q ? stook.minNetOf(q.total, [p.transferFee]) : null;
  const rising = q ? stook.feeRaises(q.total, p.transferFee, next) : false;
  const paidFor = size > 0n && pos.shares > 0n ? (pos.netPaid * size) / pos.shares : 0n;
  const submit = () => { if (!q || !publicKey || limit === null) return; send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares: -size, limit })] }, { onSuccess: () => { if (pct === 100) p.onDeselect(); } }); };
  return (
    <>
      <label className="height sell-slider">sell <Slider min={1} max={100} value={pct} onChange={setPct} width={180} /><span className="mono">{pct}%</span></label>
      {q && get !== null && limit !== null && <div className="ticket-paper" role="group" aria-label="Your sale">
        <div className="tp-win"><span>You get</span><div className="tp-win-amt"><b className="mono">{coinText(get, dec, p.quoteSymbol)}</b>{p.usd !== null && <span className="tp-usd mono">{approxUsd(get, dec, p.usd)}</span>}</div></div>
        <div className="tp-row"><span>{get >= paidFor ? "Profit" : "Loss"}</span><i /><b className={`mono ${get >= paidFor ? "tp-up" : "tp-down"}`}>{get >= paidFor ? "+" : "−"}{coinText(get >= paidFor ? get - paidFor : paidFor - get, dec, p.quoteSymbol)}</b></div>
        <PaperFold label="Limits">
          <div className="tp-row"><span>At least, if the odds move first</span><i /><b className="mono">{coinText(limit, dec, p.quoteSymbol)}</b></div>
        </PaperFold>
      </div>}
      {q && rising && <Notice tone="warn" title="Transfer fee rising">The coin's issuer has set its transfer fee to rise to {next!.bps / 100}%. If that happens before this goes through, it fails and nothing moves.</Notice>}
      <button className="primary" disabled={!q || !p.tradeable || send.isPending || !publicKey} onClick={submit}>{!p.tradeable ? closedLabel(l, p.now) : send.isPending ? "Sending…" : `Sell ${pct}%`}</button>
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
      <p className="explain">{l.status === "void" ? "The round was void: deposits come back first, open calls share the rest." : `The bell rang: it closed ${l.settledBin! > 0 && l.settledBin! < 63 ? `between ${rangeName(l, l.settledBin!, l.settledBin!, p.dp).replace(" to ", " and ")}` : rangeName(l, l.settledBin!, l.settledBin!, p.dp)}.`}</p>
      {l.status === "void" && <FoldLine label="How the rest is shared">Deposits come back first, up to what was put in. Open calls share what is left{linesPct !== null && Math.abs(linesPct - 100) >= 0.005 ? `: ${linesPct.toFixed(2)}% of what they cost, because sellers took their gains before the void` : ", at cost"}.</FoldLine>}
      {nothing ? <p className="muted">You had nothing in this round.</p> : (
        <Book kind="call" title="To collect" count={owed.length + lp.length} open total={big(total)}
          rows={[
            ...owed.map(({ r, amount }) => ({ key: r.pubkey.toBase58(), label: p.name(r.position.shape), sub: <>paid {big(r.position.netPaid)}</>, amount: amount > 0n ? <span className="up">+{money(amount)}</span> : <span className="muted">0</span> })),
            ...lp.map(({ t, v }) => ({ key: t.pubkey.toBase58(), label: `house deposit #${t.tranche.index}`, sub: <>put in {big(t.tranche.deposit)}</>, amount: money(v) })),
          ]}
          footer={<button className="primary" disabled={!publicKey || !!progress} onClick={() => void submit()}>{progress ? (progress[1] > 1 ? `Collecting ${progress[0]} of ${progress[1]}…` : "Sending…") : `Collect ${big(total)}`}</button>} />
      )}
      <p className="hint" style={{ marginTop: ".6rem" }}><Link to={p.coinSymbol ? `/c/${p.coinSymbol}` : "/"}>{p.coinSymbol ? "Back to the calendar" : "Back to the street"}</Link></p>
    </>
  );
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

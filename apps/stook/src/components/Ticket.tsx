// The order card: the one panel beside the chart. What it offers follows what
// was picked: a new call (buy), one of your calls (add to it or sell it), or,
// after the bell, one button that collects everything you have in the round.
// The House tab is the same card for depositors.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { stook } from "@sooth/sdk-solana";
import { fmtCompact, fmtPrice } from "../lib/format";
import { nyWhen } from "../lib/time";
import { ataOf, ensureAta, type PositionRow, type TrancheRow } from "../lib/chain";
import { useMint, useSend } from "../hooks/useChain";
import type { CallOrder } from "../hooks/useCallOrder";
import { LpPanel } from "./LpPanel";
import { HousePanel } from "./HousePanel";
import { Notice } from "./Notice";
import { Slider } from "./Slider";
import { coinText, fmtUsd, toUsd } from "../lib/usd";
import { coinBySymbol, coinPath } from "../lib/coins";
import { fx } from "../lib/call";
import { FAUCET_AUTHORITY_BYTES } from "../lib/config";

/** A band by what it covers: its floor, or "below …" / "above …" for the two open-ended tails. */
export function bandName(l: stook.LadderAccount, i: number, dp: number): string {
  const [lo, hi] = stook.binBounds(Math.min(Math.max(i, 0), 63), l.p0, l.stepBps);
  if (i <= 0) return `below ${fmtPrice(hi, l.p0Expo, dp)}`;
  if (i >= 63) return `above ${fmtPrice(lo, l.p0Expo, dp)}`;
  return fmtPrice(lo, l.p0Expo, dp);
}

/** A range of bands by its ends: "X to Y", or "below Y" / "above X" when it reaches a tail. */
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

/** A coin amount as plain digits an input reads back exactly. */
const plain = (u: bigint, dec: number) => { const s = u.toString().padStart(dec + 1, "0"); const i = s.slice(0, s.length - dec), f = s.slice(s.length - dec).replace(/0+$/, ""); return f ? `${i}.${f}` : i; };
/** A round number near `v`: one or two leading digits. */
const nice = (v: number) => { if (!(v > 0)) return 0; const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * e; };

interface Props {
  refs: stook.LadderRefs;
  ladder: stook.LadderAccount;
  shape: stook.Shape | null;
  selected: PositionRow | null;
  onDeselect: () => void;
  /** The one order for the call on the chart (hooks/useCallOrder). */
  order: CallOrder;
  /** The call's range, said big: "77,079 → 78,197", or what to do first. */
  range: ReactNode;
  /** A call by name, in the chart's words. */
  name: (s: stook.Shape) => string;
  /** On a held call: Add more or Sell. Kept by the page, so the phone's call bar follows it. */
  side: "buy" | "sell";
  symbol: string; dp: number; quoteSymbol: string;
  /** The coin the round is paid in, for the way back to its calendar. */
  coinSymbol?: string;
  tradeable: boolean; final: boolean;
  /** Why the round takes no calls now, in one line, when it does not. */
  closedWords: { title: string; line: string } | null;
  positions: PositionRow[]; tranches: TrancheRow[];
  transferFee?: stook.TransferFee;
  now: number;
  /** Dollars per whole coin, or null while unknown. */
  usd: number | null;
  tab: SideTab; setTab: (t: SideTab) => void;
  /** Kind of call and how sure: shown above the range on a new call. */
  kind?: ReactNode;
}

export type SideTab = "trade" | "house";

/** Call or House: the card's two sides. */
export function SideTabs({ tab, setTab }: { tab: SideTab; setTab: (t: SideTab) => void }) {
  return (
    <div className="seg2 tk-tabs" role="tablist" aria-label="Call or house">
      <button role="tab" aria-selected={tab === "trade"} className={tab === "trade" ? "on" : ""} onClick={() => setTab("trade")} title="Pick the close">Call</button>
      <button role="tab" aria-selected={tab === "house"} className={tab === "house" ? "on" : ""} onClick={() => setTab("house")} data-tour="house" title="Fund the pool">House</button>
    </div>
  );
}

export function Ticket(p: Props) {
  const tab = p.tab;
  const title = tab === "house" ? "The house"
    : p.final ? (p.ladder.status === "void" ? "Your refund" : "Collect")
    : p.selected ? (p.side === "sell" ? "Sell your call" : "Add to your call")
    : "Your call";
  return (
    <section className="card trade-order" aria-label={title}>
      <div className="tk-head">
        <h2>{title}</h2>
        <SideTabs tab={tab} setTab={p.setTab} />
      </div>
      {tab === "house" ? <div className="tk-house">{p.ladder.sharedVault
        // A round the coin's house opened is funded from the house: deposits
        // go there and stay in from round to round. A deposit someone put in
        // this round alone still shows beneath.
        ? <><HousePanel series={p.ladder.series} mint={p.ladder.quoteMint} symbol={p.quoteSymbol} bare />{p.tranches.length > 0 && <LpPanel refs={p.refs} ladder={p.ladder} quoteSymbol={p.quoteSymbol} now={p.now} transferFee={p.transferFee} usd={p.usd} bare />}</>
        : <LpPanel refs={p.refs} ladder={p.ladder} quoteSymbol={p.quoteSymbol} now={p.now} transferFee={p.transferFee} usd={p.usd} bare />}</div>
        : p.final ? <Collect {...p} />
        : p.selected ? (p.side === "buy" ? <Buy {...p} shape={p.selected.position.shape} held /> : <Sell {...p} pos={p.selected} />)
        : <Buy {...p} />}
    </section>
  );
}

const hm = (t: number | bigint) => nyWhen(t, { hour: "numeric", minute: "2-digit" });
/** What a trade button says when this round takes no trades now. */
const closedLabel = (l: Props["ladder"], now: number) =>
  l.status === "open" ? `Closed · bell at ${hm(l.settlesAt)}` : l.status === "seeding" && now < Number(l.opensAt) ? `Opens ${hm(l.opensAt)} New York` : "Not trading";

/** An amount said the way the card leads with it: dollars when the coin has a price, the coin beneath. */
function useSay(dec: number, sym: string, usd: number | null) {
  return useMemo(() => ({
    big: (u: bigint) => (usd !== null ? fmtUsd(toUsd(u, dec, usd)) : coinText(u, dec, sym)),
    sub: (u: bigint) => (usd !== null ? coinText(u, dec, sym) : ""),
    coin: (u: bigint) => coinText(u, dec, sym),
  }), [dec, sym, usd]);
}

// ── buy a call: a new one, or (`held`) more of one you already hold ──────────
// The numbers come from the page's one order (hooks/useCallOrder), which the
// chart's WIN tag and the phone's call bar read too.
function Buy(p: Props & { held?: boolean }) {
  const o = p.order;
  const { unit, text, q, pays, limit, rising, short, existing, balance, send, lands, next, feeBps } = o;
  const modal = useWalletModal();
  const connected = !!useWallet().publicKey;
  const l = p.ladder, dec = l.decimals, s = o.shape;
  const say = useSay(dec, p.quoteSymbol, p.usd);
  const budget = o.budget;
  const toWin = q ? lands(q.maxPayout) : null;
  // Quick amounts: dollars, or the coin near those dollars when it has a price.
  const presets = useMemo(() => {
    if (unit === "usd") return [1, 5, 25].map((v) => ({ label: `$${v}`, text: String(v) }));
    const coins = p.usd ? [1, 5, 25].map((v) => nice(v / p.usd!)) : [10, 100, 1000];
    return coins.map((v) => ({ label: fmtCompact(BigInt(Math.round(v * 10 ** dec)), dec), text: String(v) }));
  }, [unit, p.usd, dec]);
  const maxText = connected && balance.data !== undefined && balance.data > 0n
    ? (unit === "usd" ? (p.usd ? String(Math.floor(toUsd(balance.data, dec, p.usd) * 100) / 100) : null) : plain(balance.data, dec)) : null;
  const other = budget && budget > 0n ? (unit === "usd" ? coinText(budget, dec, p.quoteSymbol) : p.usd !== null ? `≈ ${fmtUsd(toUsd(budget, dec, p.usd))}` : "") : "";
  const ready = !!q && !o.stale && p.tradeable && !send.isPending && !short && !!p.shape;

  return (
    <div className="tk-body" data-tour="order">
      {!p.held && p.kind}
      {p.tradeable || p.shape ? <div className={`tk-range${p.shape ? "" : " empty"}`} aria-live="polite">{p.range}</div>
        : p.closedWords && <div className="tk-closed"><b>{p.closedWords.title}</b><span>{p.closedWords.line}</span></div>}
      {(p.tradeable || p.held) && <>
        <div className="tk-amt">
          <label className="tk-amt-box">
            {unit === "usd" && <span className="tk-cur" aria-hidden="true">$</span>}
            <input value={text} onChange={(e) => o.setText(e.target.value)} inputMode="decimal" aria-label={`Spend in ${unit === "usd" ? "dollars" : p.quoteSymbol}`} />
            {unit === "coin" && <span className="tk-cur after" aria-hidden="true">{p.quoteSymbol}</span>}
            <span className="tk-other">{other}</span>
          </label>
          <div className="chips chips-sm tk-presets" role="group" aria-label="Quick amounts">
            {presets.map((x) => <button key={x.label} className={`chip${text === x.text ? " on" : ""}`} onClick={() => o.setText(x.text)}>{x.label}</button>)}
            {maxText !== null && <button className={`chip${text === maxText ? " on" : ""}`} onClick={() => o.setText(maxText)}>Max</button>}
          </div>
          <div className="tk-bal">
            <span>{!connected ? "Connect a wallet to see your balance" : <>Balance {balance.data !== undefined ? <>{coinText(balance.data, dec, p.quoteSymbol)}{p.usd !== null ? ` · ${fmtUsd(toUsd(balance.data, dec, p.usd))}` : ""}</> : "…"}</>}</span>
            {p.usd !== null && <span className="tk-unit" role="group" aria-label="Enter the amount in">
              <button className={unit === "usd" ? "on" : ""} aria-pressed={unit === "usd"} onClick={() => o.setUnit("usd")}>USD</button>
              <button className={unit === "coin" ? "on" : ""} aria-pressed={unit === "coin"} onClick={() => o.setUnit("coin")}>{p.quoteSymbol}</button>
            </span>}
          </div>
        </div>
        {budget !== null && pays !== null && pays * 100n < budget * 99n && <Notice tone="warn" title="Round limit">Only {coinText(pays, dec, p.quoteSymbol)} more fits on this call: its odds are near the most this round can price. The order uses that.</Notice>}
        <div className={`tk-win${toWin === null || o.stale ? " off" : ""}`} role="group" aria-label="What it can win" data-tour="paper">
          <div>
            <div className="tk-win-l">{p.held ? "Your call pays up to" : "Win up to"}</div>
            <div className="tk-win-v">{toWin !== null ? say.big(toWin) : "–"}</div>
            {toWin !== null && <div className="tk-win-s">{say.sub(toWin)}{say.sub(toWin) && s && l.p0 > 0n ? " · " : ""}{s && l.p0 > 0n ? `if it closes ${moveFromOpen(l, Math.floor((s.lo + s.hi) / 2))}` : ""}</div>}
          </div>
          {toWin !== null && pays ? <div className="tk-win-x">{fx(Number(toWin) / Number(pays))}</div> : null}
        </div>
        {s && q && pays !== null && limit !== null && <details className="tk-more">
          <summary>Fees and limits</summary>
          <dl>
            <div><dt>{existing && !p.held ? "Adds to your call" : "Your call"}</dt><dd>{p.symbol} · {p.name(s)}</dd></div>
            <div><dt>You pay</dt><dd>{say.coin(pays)}</dd></div>
            <div><dt>Fee {(feeBps / 100).toFixed(feeBps % 100 ? 1 : 0)}%{feeBps >= stook.FEE_PEAK_BPS ? ", its highest" : Number(l.settlesAt) - p.now < 6 * 3600 ? ", rising to 5% by the lock" : ""}</dt><dd>{say.coin(q.fee)}</dd></div>
            <div><dt>Most it can cost</dt><dd>{say.coin(limit)}</dd></div>
            {pays !== q.total && <div><dt>Coin's transfer fee</dt><dd>{say.coin(pays - q.total)}</dd></div>}
          </dl>
        </details>}
        {s && q && rising && <Notice tone="warn" title="Transfer fee rising">The coin's issuer has set its transfer fee to rise to {next!.bps / 100}%. If that happens before this goes through, it fails and nothing moves.</Notice>}
        {short && <Notice tone="stop" title={`Not enough ${p.quoteSymbol}`}>You hold {fmtCompact(balance.data!, dec)}; this can cost up to {fmtCompact(limit!, dec)}.{FAUCET_AUTHORITY_BYTES ? <> Get <b>test coins</b> in the header.</> : null}</Notice>}
      </>}
      <button className="btn btn-block tk-go" data-coach="place" disabled={connected ? !ready : !p.tradeable} onClick={() => (connected ? o.submit() : modal.setVisible(true))}>
        {!p.tradeable ? closedLabel(l, p.now) : !connected ? "Connect a wallet" : !p.shape ? "Pick a price first" : send.isPending ? "Sending…" : `${p.held || existing ? "Add to call" : "Place call"}${pays !== null ? ` · ${say.big(pays)}` : ""}`}
      </button>
      {p.tradeable && pays !== null && <p className="tk-lose">Most you can lose: {say.big(pays)}</p>}
      {p.held && <button className="tk-back" onClick={p.onDeselect}>Back to a new call</button>}
      {!p.held && <p className="tk-how"><Link to="/how?step=line">How a call works ›</Link></p>}
    </div>
  );
}

// ── sell one of your calls ───────────────────────────────────────────────────
function Sell(p: Props & { pos: PositionRow }) {
  const { publicKey } = useWallet();
  const [pct, setPct] = useState(100);
  const send = useSend("Sold");
  const l = p.ladder, dec = l.decimals, pos = p.pos.position, s = pos.shape;
  const say = useSay(dec, p.quoteSymbol, p.usd);
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
  const gain = get !== null ? get - paidFor : null;
  return (
    <div className="tk-body">
      <div className="tk-range"><span className="tk-range-v">{p.name(s)}</span><span className="tk-range-s">Paid {say.big(pos.netPaid)}</span></div>
      <div className="tk-sell">
        <div className="tk-sell-top"><span className="label">Sell</span><b className="num">{pct}%</b></div>
        <Slider min={1} max={100} value={pct} onChange={setPct} label="How much to sell" />
        <div className="chips chips-sm" role="group" aria-label="Quick amounts">{[25, 50, 100].map((v) => <button key={v} className={`chip${pct === v ? " on" : ""}`} onClick={() => setPct(v)}>{v === 100 ? "All" : `${v}%`}</button>)}</div>
      </div>
      <div className={`tk-win${get === null ? " off" : ""}`} role="group" aria-label="Your sale">
        <div>
          <div className="tk-win-l">You get</div>
          <div className="tk-win-v">{get !== null ? say.big(get) : "–"}</div>
          {get !== null && say.sub(get) && <div className="tk-win-s">{say.sub(get)}</div>}
        </div>
        {gain !== null && <div className={`tk-win-x ${gain >= 0n ? "up" : "down"}`}>{gain >= 0n ? "+" : "−"}{say.big(gain >= 0n ? gain : -gain)}</div>}
      </div>
      {q && limit !== null && <details className="tk-more">
        <summary>Limits</summary>
        <dl>
          <div><dt>{gain !== null && gain >= 0n ? "Profit" : "Loss"}</dt><dd className={gain !== null && gain >= 0n ? "up" : "down"}>{gain !== null ? `${gain >= 0n ? "+" : "−"}${say.coin(gain >= 0n ? gain : -gain)}` : ""}</dd></div>
          <div><dt>At least, if the odds move first</dt><dd>{say.coin(limit)}</dd></div>
        </dl>
      </details>}
      {q && rising && <Notice tone="warn" title="Transfer fee rising">The coin's issuer has set its transfer fee to rise to {next!.bps / 100}%. If that happens before this goes through, it fails and nothing moves.</Notice>}
      <button className="btn btn-block tk-go" disabled={!q || !p.tradeable || send.isPending || !publicKey} onClick={submit}>{!p.tradeable ? closedLabel(l, p.now) : send.isPending ? "Sending…" : `Sell ${pct}%`}</button>
      <button className="tk-back" onClick={p.onDeselect}>Back to a new call</button>
    </div>
  );
}

// ── after the bell: everything you have here, in one go ──────────────────────
function Collect(p: Props) {
  const { publicKey } = useWallet();
  const modal = useWalletModal();
  const send = useSend(p.ladder.status === "void" ? "Refunded" : "Collected");
  const l = p.ladder, dec = l.decimals;
  const say = useSay(dec, p.quoteSymbol, p.usd);
  // Shown as it lands in the wallet: the pool sends the book amount and the
  // coin's transfer fee, if any, comes off on the way.
  const lands = (book: bigint) => stook.netOf(book, p.transferFee);
  // A void pays depositors first, then open calls share what is left.
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
  const [why, setWhy] = useState(false);
  return (
    <div className="tk-body">
      {/* Where it closed is said once, in the chart card's head. */}
      <div className="tk-closed"><b>{l.status === "void" ? "This round was void" : "The bell rang"}</b>{l.status === "void" && <span>Deposits come back first. Open calls share the rest.</span>}
        {l.status === "void" && <button className="tk-link" onClick={() => setWhy(!why)} aria-expanded={why}>How the rest is shared</button>}
        {why && <span className="tk-why">Deposits come back first, up to what was put in. Open calls share what is left{linesPct !== null && Math.abs(linesPct - 100) >= 0.005 ? `: ${linesPct.toFixed(2)}% of what they cost, because sellers took their gains before the void` : ", at cost"}.</span>}
      </div>
      {!publicKey ? <>
        <p className="tk-empty">Connect a wallet to see what you can collect.</p>
        <button className="btn btn-block tk-go" onClick={() => modal.setVisible(true)}>Connect a wallet</button>
      </> : nothing ? <p className="tk-empty">You had nothing in this round.</p> : <>
        <ul className="tk-book" aria-label="To collect">
          {owed.map(({ r, amount }) => <li key={r.pubkey.toBase58()}><span><b>{p.name(r.position.shape)}</b><small>Paid {say.big(r.position.netPaid)}</small></span><em className={amount > 0n ? "up" : "dimmer"}>{amount > 0n ? `+${say.big(amount)}` : "0"}</em></li>)}
          {lp.map(({ t, v }) => <li key={t.pubkey.toBase58()}><span><b>House deposit {t.tranche.index + 1}</b><small>Put in {say.big(t.tranche.deposit)}</small></span><em>{say.big(v)}</em></li>)}
        </ul>
        <div className="tk-win"><div><div className="tk-win-l">To collect</div><div className="tk-win-v">{say.big(total)}</div>{say.sub(total) && <div className="tk-win-s">{say.sub(total)}</div>}</div></div>
        <button className="btn btn-block tk-go" disabled={!!progress} onClick={() => (publicKey ? void submit() : modal.setVisible(true))}>{!publicKey ? "Connect a wallet" : progress ? (progress[1] > 1 ? `Collecting ${progress[0]} of ${progress[1]}…` : "Sending…") : `Collect ${say.big(total)}`}</button>
      </>}
      <p className="tk-how"><Link to={p.coinSymbol ? coinPath(coinBySymbol(p.coinSymbol) ?? { symbol: p.coinSymbol }) : "/"}>{p.coinSymbol ? "Back to the calendar" : "Back to the street"}</Link></p>
    </div>
  );
}

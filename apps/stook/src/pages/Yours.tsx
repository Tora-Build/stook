// Yours: a brokerage statement from the house on the street. Every round the
// wallet is in, what it put where, what that is worth now or pays, and one
// button per finished round to collect all of it. Amounts stay in each
// round's own coin: $STOOK and $KNOTS do not add up, so they are never summed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { useHoldings, useMint, useSend } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { ataOf, ensureAta, type Holding } from "../lib/chain";
import { COINS, anchorOf, coinByMint } from "../lib/coins";
import { feedByHex, feedHex } from "../lib/feeds";
import { fmtCompact, short } from "../lib/format";
import { Amount, approxUsd, coinText, fmtUsd, toUsd, useUsdRates } from "../lib/usd";
import { bandName, rangeName } from "../components/Ticket";
import { Book } from "../components/Book";
import { Fold } from "../components/Fold";
import { nyDate, nyWhen } from "../lib/time";

type Stage = "funded" | "opening" | "void soon" | "trading" | "locked" | "settling" | "settled" | "void";

const stageOf = (l: stook.LadderAccount, now: number): Stage =>
  l.status === "settled" ? "settled" : l.status === "void" ? "void"
    : l.status === "seeding" ? (now < Number(l.opensAt) ? "funded" : now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) && now < Number(l.locksAt) ? "opening" : "void soon")
    : now < Number(l.locksAt) ? "trading" : now < Number(l.settlesAt) ? "locked" : "settling";

interface Line { key: string; what: string; size: bigint; cost: bigint; value: bigint | null; kind: "line" | "house"; note?: string; fees?: bigint }
interface Valued { lines: Line[]; ready: bigint; atWork: bigint; inHouse: bigint }

/** What each thing in a round is worth: paid out if final, sold now if trading. */
function value(h: Holding, now: number, dp: number): Valued {
  const l = h.ladder, final = l.status === "settled" || l.status === "void";
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(now), l.settlesAt);
  const lines: Line[] = [];
  let ready = 0n, atWork = 0n, inHouse = 0n;
  for (const r of h.positions) {
    const p = r.position;
    if (!final && p.shares === 0n) continue;
    const s = p.shape;
    const what = s.h > 1 ? `target at ${bandName(l, Math.floor((s.lo + s.hi) / 2), dp)}, reach ${s.h}` : `${rangeName(l, s.lo, s.hi, dp)} range`;
    let v: bigint | null = null;
    if (final) { v = stook.owedTo(l, p); ready += v > 0n ? v : 0n; }
    else if (l.status === "open" && now < Number(l.locksAt) && p.shares > 0n) {
      try { v = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, s, -p.shares).total; } catch { v = null; }
    }
    if (!final) atWork += p.netPaid;
    lines.push({ key: r.pubkey.toBase58(), kind: "line", what, size: p.shares, cost: p.netPaid, value: v, note: final ? undefined : v === null ? "held to the bell" : "if sold now" });
  }
  for (const r of h.tranches) {
    const t = r.tranche;
    let v: bigint | null = null, note: string | undefined, fees: bigint | undefined;
    if (l.status === "settled" && l.settledBin !== null) {
      const k = l.settledBin, tt = stook.trancheTerms(l, t);
      v = stook.tranchePrincipal(t.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), l.decimals) + stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap);
      ready += v;
    } else if (l.status === "void") {
      v = stook.voidShare(t.deposit, l.voidLpPot, l.depositTotal); ready += v;
    } else {
      inHouse += t.deposit;
      const tt = stook.trancheTerms(l, t);
      fees = tt.b > 0n ? stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap) : 0n;
    }
    lines.push({ key: r.pubkey.toBase58(), kind: "house", what: `house deposit #${t.index}`, size: t.deposit, cost: t.deposit, value: v, note, fees });
  }
  return { lines, ready, atWork, inHouse };
}

export function Yours() {
  const { publicKey: wallet } = useWallet();
  // `?account=` reads any address's statement, read-only: holdings are public
  // on chain, and only the connected wallet gets collect buttons.
  const [params] = useSearchParams();
  const viewed = useMemo(() => { try { const a = params.get("account"); return a ? new PublicKey(a) : null; } catch { return null; } }, [params]);
  const publicKey = viewed ?? wallet;
  const own = !!wallet && !!publicKey && wallet.equals(publicKey);
  const now = useNow();
  const holdings = useHoldings(publicKey ?? null);
  const rates = useUsdRates().data ?? {};
  const rounds = [...(holdings.data ?? [])].sort((a, b) => Number(a.ladder.settlesAt - b.ladder.settlesAt));
  const byCoin = new Map<string, { dec: number; ready: bigint; atWork: bigint; inHouse: bigint }>();
  for (const h of rounds) {
    const c = coinByMint(h.ladder.quoteMint)?.symbol ?? "tokens", v = value(h, now, 2);
    const t = byCoin.get(c) ?? { dec: h.ladder.decimals, ready: 0n, atWork: 0n, inHouse: 0n };
    byCoin.set(c, { dec: t.dec, ready: t.ready + v.ready, atWork: t.atWork + v.atWork, inHouse: t.inHouse + v.inHouse });
  }
  const tote = (pick: (x: { ready: bigint; atWork: bigint; inHouse: bigint }) => bigint) => {
    const rows = [...byCoin.entries()].filter(([, x]) => pick(x) > 0n);
    // In dollars across every coin, then each coin as held.
    const usd = rows.reduce((a, [c, x]) => (rates[c] ? a + toUsd(pick(x), x.dec, rates[c]!) : a), 0);
    return rows.length ? <>{rows.some(([c]) => rates[c]) && <div className="tote-usd mono" title="Every coin at today's price">≈ {fmtUsd(usd)}</div>}<div className="tote-coins">{rows.map(([c, x]) => { const coin = COINS.find((k) => k.symbol === c); return <span key={c} className="tote-chip mono" title={`$${c}`}>{coin && <img src={coin.logo} alt={`$${c}`} />}{fmtCompact(pick(x), x.dec)}</span>; })}</div></> : <div className="tote-v mono muted">$0</div>;
  };
  const finished = rounds.filter((h) => { const s = stageOf(h.ladder, now); return s === "settled" || s === "void"; });

  // One button collects every finished round: each round's row registers
  // how to collect it, and the slip runs them one after another.
  const collectors = useRef(new Map<string, () => Promise<void>>());
  const register = useCallback((k: string, fn: (() => Promise<void>) | null) => { if (fn) collectors.current.set(k, fn); else collectors.current.delete(k); }, []);
  const [allProgress, setAllProgress] = useState<[number, number] | null>(null);
  const collectAll = async () => {
    const keys = finished.map((h) => h.pubkey.toBase58()).filter((k) => collectors.current.has(k));
    for (let n = 0; n < keys.length; n++) { setAllProgress([n + 1, keys.length]); await collectors.current.get(keys[n]!)!(); }
    setAllProgress(null);
  };

  // The passbook: newest day first, filtered by coin and by state, each round
  // one line that opens into its detail.
  const [coinF, setCoinF] = useState("all");
  const [view, setView] = useState<"all" | "open" | "done">("all");
  const coinsHeld = [...new Set(rounds.map((h) => coinByMint(h.ladder.quoteMint)?.symbol).filter(Boolean) as string[])];
  const shown = [...rounds].reverse().filter((h) => (coinF === "all" || coinByMint(h.ladder.quoteMint)?.symbol === coinF) && (view === "all" || (view === "done") === finished.includes(h)));
  const days: [string, Holding[]][] = [];
  for (const h of shown) { const d = nyDate(Number(h.ladder.settlesAt)); const last = days.at(-1); if (last && last[0] === d) last[1].push(h); else days.push([d, [h]]); }
  const today = nyDate(now), yesterday = nyDate(now - 86_400);
  const [jump, setJump] = useState<string | null>(null);
  const pick = (d: string) => setJump(d);
  const dayName = (d: string, t: bigint) => `${nyWhen(t, { weekday: "long", month: "short", day: "numeric" })}${d === today ? " · today" : d === yesterday ? " · yesterday" : ""}`;

  // The slip's lines and total, in dollars across coins.
  const slip = finished.map((h) => {
    const c = coinByMint(h.ladder.quoteMint), v = value(h, now, c ? anchorOf(c).dp : 2), rate = c ? rates[c.symbol] ?? null : null;
    return { h, c, ready: v.ready, usd: rate !== null ? toUsd(v.ready, h.ladder.decimals, rate) : null };
  });
  const slipUsd = slip.reduce((a, x) => a + (x.usd ?? 0), 0);
  const slipCoins = [...new Set(slip.filter((x) => x.ready > 0n).map((x) => x.c?.symbol ?? ""))];
  const oneCoin = slipCoins.length <= 1 ? slip.find((x) => x.ready > 0n) : undefined;
  const slipTotal = oneCoin ? coinText(slip.reduce((a, x) => a + x.ready, 0n), oneCoin.h.ladder.decimals, `$${oneCoin.c?.symbol ?? ""}`) : `≈ ${fmtUsd(slipUsd)}`;
  const [slipOpen, setSlipOpen] = useState(false);
  const SLIP_SHOWN = 4;

  return (
    <div className="page statement">
      <header className="stmt-head">
        <div>
          <div className="stmt-firm">STOOK STREET SECURITIES</div>
          <h1>Statement of account</h1>
        </div>
        <dl className="stmt-meta mono">
          <div><dt>account</dt><dd>{publicKey ? short(publicKey) : "not connected"}{publicKey && !own ? " · read only" : ""}</dd></div>
          <div><dt>as of</dt><dd>{new Date(now * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd></div>
        </dl>
      </header>

      {!publicKey ? <p className="stmt-empty">Connect a wallet to read its statement.</p>
        : holdings.isLoading ? <p className="stmt-empty">Reading the books…</p>
        : rounds.length === 0 ? <p className="stmt-empty">Nothing on the books yet. <Link to="/#floor">Pick a table ›</Link></p>
        : <>
          <section className="tote">
            <div className="tote-cell tote-ready"><div className="tote-k">ready to collect</div>{tote((x) => x.ready)}</div>
            <div className="tote-cell"><div className="tote-k">calls at work</div>{tote((x) => x.atWork)}</div>
            <div className="tote-cell"><div className="tote-k">in the house</div>{tote((x) => x.inHouse)}</div>
          </section>

          {slip.length > 0 && (
            <div className="ticket-paper payout-slip" role="group" aria-label="Payout slip">
              <div className="tp-head"><span>Payout slip</span><b className="mono">{slip.length} finished {slip.length === 1 ? "round" : "rounds"}</b></div>
              {slip.slice(0, SLIP_SHOWN).map((x) => <SlipLine key={x.h.pubkey.toBase58()} {...x} now={now} />)}
              {slip.length > SLIP_SHOWN && <>
                <div className={`tp-fold ${slipOpen ? "tp-fold-open" : ""}`}>
                  <div className="tp-fold-in">{slip.slice(SLIP_SHOWN).map((x) => <SlipLine key={x.h.pubkey.toBase58()} {...x} now={now} />)}</div>
                </div>
                <button className="tp-unfold" onClick={() => setSlipOpen(!slipOpen)} aria-expanded={slipOpen}>{slipOpen ? "Fold it back" : `Unfold ${slip.length - SLIP_SHOWN} more ${slip.length - SLIP_SHOWN === 1 ? "round" : "rounds"}`}</button>
              </>}
              <div className="tp-win">
                <div className="tp-win-top"><span>Total to collect</span></div>
                <b className="mono">{slipTotal}</b>
                <div className="tp-note">{oneCoin ? (slipUsd > 0 ? `≈ ${fmtUsd(slipUsd)} today` : "") : slip.filter((x) => x.ready > 0n).map((x) => `${fmtCompact(x.ready, x.h.ladder.decimals)} $${x.c?.symbol ?? ""}`).join(" + ") || "rounds that paid nothing, to close"}</div>
              </div>
              {own
                ? <button className="primary" disabled={!!allProgress} onClick={() => void collectAll()}>{allProgress ? `Collecting ${allProgress[0]} of ${allProgress[1]}…` : slipUsd > 0 || oneCoin ? `Collect all ${slipTotal}` : "Close them all"}</button>
                : <p className="tp-dim small">Only the account's own wallet can collect.</p>}
            </div>
          )}

          <div className="pb-filters">
            <div className="seg seg-sm" role="group" aria-label="Show">
              {(["all", "open", "done"] as const).map((k) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{k === "all" ? "All" : k === "open" ? "Running" : "Finished"}</button>)}
            </div>
            {coinsHeld.length > 1 && <div className="pb-coins" role="group" aria-label="Coin">
              <button className={`pb-chip ${coinF === "all" ? "on" : ""}`} onClick={() => setCoinF("all")}>every coin</button>
              {coinsHeld.map((c) => { const coin = COINS.find((x) => x.symbol === c); return <button key={c} className={`pb-chip ${coinF === c ? "on" : ""}`} onClick={() => setCoinF(c)}>{coin && <img src={coin.logo} alt="" />}${c}</button>; })}
            </div>}
          </div>

          {days.length > 1 && <DayPicker days={days.map(([d, hs]) => [d, hs.length])} today={today} onPick={pick} />}
          {days.length === 0 && <p className="stmt-empty">Nothing here with these filters.</p>}
          {jump && <div className="dp-showing"><span>Showing {nyWhen(Number(days.find(([d]) => d === jump)?.[1][0]?.ladder.settlesAt ?? 0), { weekday: "long", month: "short", day: "numeric" })}</span><button className="link" onClick={() => setJump(null)}>show every day</button></div>}
          {days.filter(([d]) => !jump || d === jump).map(([d, hs], n) => (
            <Day key={d} id={`day-${d}`} name={dayName(d, hs[0]!.ladder.settlesAt)} count={hs.length} startOpen={n < 3 || jump === d} force={jump === d}>
              {hs.map((h) => <RoundBlock key={h.pubkey.toBase58()} h={h} now={now} own={own} register={register} />)}
            </Day>
          ))}
          <p className="stmt-foot">Amounts are in each round's coin; ≈ dollars move with today's price. Thirty days after a close, anyone may send what it owes you to your wallet.</p>
        </>}
    </div>
  );
}

/** A month of dates, the days you hold something in marked: pick one to
 *  open it in the passbook below. For a long history, faster than scrolling. */
function DayPicker({ days, today, onPick }: { days: [string, number][]; today: string; onPick: (d: string) => void }) {
  const held = new Map(days);
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(() => (days[0]?.[0] ?? today).slice(0, 7));
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(d.toISOString().slice(0, 7)); };
  const cells = [...Array(first).fill(null), ...Array.from({ length: len }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  return (
    <div className="dp">
      <button className="pb-chip" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close the calendar" : "Go to a day"}</button>
      {open && <div className="dp-card">
        <div className="dp-head"><button onClick={() => shift(-1)} aria-label="Earlier month">‹</button><span>{new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span><button onClick={() => shift(1)} aria-label="Later month">›</button></div>
        <div className="dp-grid">
          {["S", "M", "T", "W", "T", "F", "S"].map((w, n) => <span key={n} className="dp-dow">{w}</span>)}
          {cells.map((d, n) => d === null ? <span key={"b" + n} /> : (
            <button key={d} className={`dp-day ${held.has(d) ? "dp-held" : ""} ${d === today ? "dp-today" : ""}`} disabled={!held.has(d)} onClick={() => { onPick(d); setOpen(false); }} title={held.has(d) ? `${held.get(d)} ${held.get(d) === 1 ? "round" : "rounds"}` : undefined}>{Number(d.slice(8))}</button>
          ))}
        </div>
      </div>}
    </div>
  );
}

/** A day in the passbook: the three latest open, older ones folded to their
 *  header, so a long history is a column of dates to open, not a scroll. */
function Day({ id, name, count, startOpen, force, children }: { id: string; name: string; count: number; startOpen: boolean; force: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { if (force) setOpen(true); }, [force]);
  return (
    <section className="pb-day" id={id}>
      <h2 className="pb-date"><button onClick={() => setOpen(!open)} aria-expanded={open}><span className="pb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{name}<em>{count} {count === 1 ? "round" : "rounds"}</em></button></h2>
      <Fold open={open}>{children}</Fold>
    </section>
  );
}

/** One round on the payout slip; its holdings unfold beneath it. */
function SlipLine({ h, c, ready, usd, now }: { h: Holding; c: ReturnType<typeof coinByMint>; ready: bigint; usd: number | null; now: number }) {
  const [open, setOpen] = useState(false);
  const v = value(h, now, c ? anchorOf(c).dp : 2), dec = h.ladder.decimals, sym = `$${c?.symbol ?? ""}`;
  const money = (u: bigint) => coinText(u, dec, sym);
  return (
    <div className={`tp-line ${open ? "tp-line-open" : ""}`}>
      <button className="tp-row tp-row-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><span className="tp-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{c ? c.anchor.name : "round"} in {sym} · {nyWhen(h.ladder.settlesAt, { weekday: "short", month: "short", day: "numeric" })}{h.ladder.status === "void" ? " · void" : ""}</span><i />
        <b className="mono">{ready === 0n ? <span className="tp-dim">nothing won</span> : coinText(ready, dec, sym)}{ready > 0n && usd !== null && <small className="approx">≈ {fmtUsd(usd)}</small>}</b>
      </button>
      <div className="tp-fold tp-fold-sub">
        <div className="tp-fold-in">
          {v.lines.map((x) => (
            <div key={x.key} className="tp-row tp-sub">
              <span>{x.kind === "line" ? `call: ${x.what}` : x.what} · {x.kind === "line" ? "paid" : "put in"} {money(x.cost)}</span><i />
              <span className="mono">{x.value && x.value > 0n ? money(x.value) : "0"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoundBlock({ h, now, own, register }: { h: Holding; now: number; own: boolean; register: (k: string, fn: (() => Promise<void>) | null) => void }) {
  const [open, setOpen] = useState(false);
  const { publicKey } = useWallet();
  const l = h.ladder, coin = coinByMint(l.quoteMint), feed = feedByHex(feedHex(l.feedId));
  const mint = useMint(l.quoteMint);
  const send = useSend(l.status === "void" ? "Refunded" : "Collected");
  const stage = stageOf(l, now);
  const dp = coin ? anchorOf(coin).dp : 2;
  const v = value(h, now, dp);
  const rates = useUsdRates().data;
  const rate = coin ? rates?.[coin.symbol] ?? null : null;
  // Dollars lead when the coin has a price; the coin amount sits beneath.
  const amt = (u: bigint, sign = "") => rate !== null
    ? <><span className="amt-big">{sign}{coinText(u, l.decimals, sym)}</span><span className="amt-coin">{approxUsd(u, l.decimals, rate)}</span></>
    : <span className="amt-big">{sign}{coinText(u, l.decimals, sym)}</span>;
  const big = (u: bigint) => coinText(u, l.decimals, sym);
  const collectable = own && (stage === "settled" || stage === "void") && (h.positions.length + h.tranches.length) > 0;
  const collect = async () => {
    if (!publicKey || !mint.data) return;
    const refs = { ladder: h.pubkey, quoteMint: l.quoteMint, tokenProgram: mint.data.tokenProgram };
    const ata = ataOf(l.quoteMint, publicKey, mint.data.tokenProgram);
    const chunks = stook.packByCompute([
      ...h.positions.map((r) => ({ ix: stook.redeemLadderIx(refs, publicKey, ata, r.position.shape), units: stook.REDEEM_COMPUTE_UNITS })),
      ...h.tranches.map((t) => ({ ix: stook.claimLpIx(refs, publicKey, ata, t.tranche.index), units: stook.claimComputeUnits(l, t.tranche) })),
    ]);
    try {
      for (let n = 0; n < chunks.length; n++) await send.mutateAsync({ computeUnits: chunks[n]!.units, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, publicKey, mint.data.tokenProgram)] : []), ...chunks[n]!.ixs] });
    } catch { /* the toast has said why */ }
  };
  const sym = coin ? `$${coin.symbol}` : "";
  // Named by the coin's real anchor, as everywhere but the round page and
  // the fund sheet (which name the devnet stand-in feed, with a note).
  const shownAnchor = coin ? coin.anchor : null;
  const final = stage === "settled" || stage === "void";
  const pnl = (x: Line) => (x.value === null ? null : x.value - x.cost);
  const key = h.pubkey.toBase58();
  useEffect(() => { register(key, collectable ? collect : null); return () => register(key, null); });
  // The line: what went in, what it is worth now (or pays), and the result.
  const cost = v.lines.reduce((a, x) => a + x.cost, 0n);
  const valued = v.lines.filter((x) => x.value !== null);
  const worth = final ? v.ready : valued.length ? v.lines.reduce((a, x) => a + (x.value ?? x.cost), 0n) : null;
  const result = final ? v.ready - cost : valued.length ? valued.reduce((a, x) => a + x.value! - x.cost, 0n) : null;
  const calls = h.positions.length, deps = h.tranches.length;
  return (
    <article className={`pb-round stage-${stage.replace(" ", "-")} ${open ? "pb-open" : ""}`}>
      <button className="pb-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        {coin && <span className="logos logos-anchor-first"><img src={coin.anchor.logo} alt="" className="logo-coin" /><img src={coin.logo} alt="" className="logo-anchor" /></span>}
        <span className="pb-name">{shownAnchor ? shownAnchor.name : feed.name}<em>in {sym} · {[calls && `${calls} ${calls === 1 ? "call" : "calls"}`, deps && `${deps} house`].filter(Boolean).join(" · ")}</em></span>
        <span className={`stamp stamp-${stage.replace(" ", "-")}`}>{stage}</span>
        <span className="pb-num"><em>in</em>{big(cost)}{rate !== null && <small className="pb-usd">{approxUsd(cost, l.decimals, rate)}</small>}</span>
        <span className="pb-num"><em>{final ? "pays" : "now"}</em>{worth === null ? "–" : big(worth)}{worth !== null && rate !== null && <small className="pb-usd">{approxUsd(worth, l.decimals, rate)}</small>}</span>
        <span className={`pb-num pb-res ${result === null ? "muted" : result >= 0n ? "up" : "down"}`}><em>result</em>{result === null ? "at the bell" : `${result >= 0n ? "+" : "−"}${big(result >= 0n ? result : -result)}`}{result !== null && rate !== null && <small className="pb-usd">{approxUsd(result >= 0n ? result : -result, l.decimals, rate).replace("≈ ", result >= 0n ? "≈ +" : "≈ −")}</small>}</span>
        <span className="pb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="pb-body">
      <div className="pb-when muted small">closes {nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} New York</div>
      {/* A finished round reads as a book: what each holding pays, the
          total, and one button for all of it, as on the round page. */}
      {final ? (() => {
        const cost = v.lines.reduce((a, x) => a + x.cost, 0n), d = v.ready - cost;
        return (
          <div className="stmt-book">
            <Book kind="call" title={stage === "void" ? "Refund" : "To collect"} count={v.lines.length} open total={big(v.ready)}
              extra={cost > 0n ? <span className={d < 0n ? "down" : "up"}>{d >= 0n ? "+" : "−"}{big(d >= 0n ? d : -d)}</span> : undefined}
              rows={v.lines.map((x) => ({
                key: x.key,
                label: <><span className={`chip-k ${x.kind}`}>{x.kind === "line" ? "CALL" : "HOUSE"}</span> {x.what}</>,
                sub: <>{x.kind === "line" ? "paid" : "put in"} {big(x.cost)}</>,
                amount: x.value !== null && x.value > 0n ? <span className="up"><Amount units={x.value} decimals={l.decimals} symbol={sym} rate={rate} /></span> : <span className="muted">0</span>,
              }))}
              footer={!collectable ? <span className="muted small">Only the account's own wallet can collect.</span>
                : v.ready > 0n ? <button className="primary" disabled={!publicKey || send.isPending} onClick={() => void collect()}>{send.isPending ? "Collecting…" : `Collect ${big(v.ready)}`}</button>
                : <button className="small" disabled={!publicKey || send.isPending} onClick={() => void collect()}>{send.isPending ? "Closing…" : "Nothing won: close these out"}</button>} />
          </div>
        );
      })() : (
        <table className="ledger">
        <thead><tr><th>holding</th><th>cost</th><th>worth</th><th>result</th></tr></thead>
        <tbody>
          {v.lines.map((x) => { const r = pnl(x); return (
            <tr key={x.key} className={x.kind}>
              <td><span className={`chip-k ${x.kind}`}>{x.kind === "line" ? "CALL" : "HOUSE"}</span> {x.what}{x.fees !== undefined ? <div className="ledger-note">fees so far {big(x.fees)} · the rest is settled at the bell</div> : x.note && <div className="ledger-note">{x.note}</div>}</td>
              <td className="mono">{amt(x.cost)}</td>
              <td className="mono">{x.value === null ? "–" : amt(x.value)}</td>
              <td className={`mono ${r === null ? "muted" : r >= 0n ? "up" : "down"}`}>{r === null ? "at the bell" : amt(r >= 0n ? r : -r, r >= 0n ? "+" : "−")}</td>
            </tr>); })}
        </tbody>
        </table>
      )}
      <footer className="stmt-round-foot">
        <Link to={`/m/${h.pubkey.toBase58()}`} className="small as-link">{stage === "trading" ? "To the table ›" : "Open the round ›"}</Link>
      </footer>
      </div>}
    </article>
  );
}

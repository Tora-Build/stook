// History: every round a wallet played, finished ones too. The desk's other
// tabs list the accounts that still exist, and collecting closes them, so a
// round you collected leaves no trace there; this reads the ledger instead
// (infra/ledger, through the site's /history route): one ticket per round with
// what went in, what came back and how it ended, newest close first.
//
// The stamp follows the money: a finished round that came back with more
// than went in is WON, less is LOST, the same is EVEN, whatever the calls did
// (a house deposit can pay when no call landed, and many calls can cost more
// than the one that landed paid). Whether a call landed is said beside it.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ConnectWallet } from "./ConnectWallet";
import { anchorOf, COINS, coinByMint, keyOf, type Coin } from "../lib/coins";
import { EXPLORER } from "../lib/config";
import { fmtCompact } from "../lib/format";
import { coinText, fmtUsd, toUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { Fold } from "./Fold";
import { PixelBell } from "./yours/art";
import { floorWords } from "./yours/model";

type Result = "won" | "missed" | "refunded" | "open" | "unclaimed";
interface Action { sig: string | null; time: number | null; kind: string; name: string | null; shares: string | null; amountIn: string; amountOut: string; fee: string; by: string | null }
interface Round {
  ladder: string; coin: string | null; quoteMint: string | null; decimals: number | null;
  feed: { id: string; symbol: string | null; name: string | null; dp: number } | null;
  settlesAt: number | null; status: string;
  settled: { price: string | null; bin: number; band: string } | null;
  result: Result; paid: string; got: string; net: string; owed: string | null; claimable: boolean;
  calls: string[]; house: boolean; actions: Action[];
}
interface CoinTotal { mint: string | null; coin: string | null; decimals: number | null; rounds: number; paid: string; got: string; net: string; owed: string; atWork?: string }
interface Page {
  totals: { rounds: number; results: Record<Result, number>; coins: CoinTotal[] };
  matching: number; rounds: Round[]; next: string | null;
  indexed?: { through: number | null; complete: boolean };
}

const PAGE = 12;
const CALLS_SHOWN = 4;
// The server's filters: "won" means a call paid (or a house-only round came
// out ahead), "missed" that none did. Named for the calls ("hit", "missed"),
// never for the money, which the stamp says (Won, Lost, Even).
const RESULTS: [Result | "all", string][] = [["all", "All"], ["won", "Hit"], ["missed", "Missed"], ["refunded", "Refunded"], ["unclaimed", "To collect"], ["open", "Running"]];

/** The ledger writes prices bare ("Between 78,197 and 79,046"); the desk
 *  writes them as on the open calls ("Between $78,197 and $79,046"), in floors. */
const px = (t: string) => floorWords(t).replace(/(^|[\s(])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+)/g, "$1$$$2");

/** The stamp, from the money, so it never says the opposite of the net. */
export function stampOf(result: Result, net: bigint): { text: string; tone: "up" | "down" | "even" | "now" | "taxi" } {
  if (result === "open") return { text: "Running", tone: "now" };
  if (result === "unclaimed") return { text: "To collect", tone: "taxi" };
  if (result === "refunded") return { text: "Refunded", tone: "even" };
  return net > 0n ? { text: "Won", tone: "up" } : net < 0n ? { text: "Lost", tone: "down" } : { text: "Even", tone: "even" };
}

async function fetchHistory(wallet: string, before: string | null, coin: string, result: string): Promise<Page> {
  const q = new URLSearchParams({ wallet, limit: String(PAGE) });
  if (before) q.set("before", before);
  if (coin !== "all") q.set("coin", coin);
  if (result !== "all") q.set("result", result);
  const r = await fetch(`/history?${q}`);
  if (!r.ok) throw new Error(`history ${r.status}`);
  return r.json();
}

const coinOf = (mint: string | null, sym: string | null): Coin | undefined => {
  if (mint) { try { const c = coinByMint(new PublicKey(mint)); if (c) return c; } catch { /* not an address */ } }
  return sym ? COINS.find((c) => c.symbol === sym || keyOf(c) === sym) : undefined;
};
const abs = (v: bigint) => (v < 0n ? -v : v);
const signed = (v: bigint) => (v > 0n ? "+" : v < 0n ? "−" : "");

export function History({ wallet, own, onCollect }: { wallet: PublicKey | null; own: boolean; onCollect?: () => void }) {
  const [coinF, setCoinF] = useState("all");
  const [resultF, setResultF] = useState<Result | "all">("all");
  const key = wallet?.toBase58() ?? "";
  const q = useInfiniteQuery({
    queryKey: ["history", key, coinF, resultF],
    queryFn: ({ pageParam }) => fetchHistory(key, pageParam, coinF, resultF),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: !!wallet,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const rates = useUsdRates().data ?? {};

  // The coin chips: every coin this wallet has played, remembered across
  // filters (a filtered answer lists only its own coin).
  const [played, setPlayed] = useState<string[]>([]);
  const first = q.data?.pages[0];
  useEffect(() => {
    if (!first || coinF !== "all") return;
    const syms = first.totals.coins.map((c) => coinOf(c.mint, c.coin)?.symbol).filter(Boolean) as string[];
    setPlayed((p) => [...new Set([...p, ...syms])]);
  }, [first, coinF]);
  useEffect(() => { setPlayed([]); setCoinF("all"); setResultF("all"); }, [key]);

  const rounds = useMemo(() => q.data?.pages.flatMap((p) => p.rounds) ?? [], [q.data]);
  const moreFailed = q.isFetchNextPageError, fetchMore = q.fetchNextPage;

  if (!wallet) return (
    <div className="card yours-empty">
      <span className="yours-empty-ico"><PixelBell size={48} /></span>
      <div><h3>Every bell you heard</h3><p className="dim">Connect a wallet to see every round it played, collected ones included.</p><div className="yours-connect"><ConnectWallet>Connect a wallet</ConnectWallet></div></div>
    </div>
  );
  if (q.isLoading) return <div className="yours-hist" aria-busy="true" aria-label="Reading the ledger"><div className="yours-hist-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="card yours-skel yours-skel-s"><i /><i /></div>)}</div>{[0, 1, 2].map((i) => <div key={i} className="card yours-skel yours-skel-wide"><i /><i /><i /></div>)}</div>;
  if (q.isError || !first) return (
    <div className="card yours-empty">
      <span className="yours-empty-ico yours-dim-art"><PixelBell size={48} /></span>
      <div><h3>The history is out of reach</h3><p className="dim">Your holdings are unaffected, and it will be back shortly.</p><button className="btn btn-sm btn-ghost" onClick={() => void q.refetch()}>Try again</button></div>
    </div>
  );

  const t = first.totals;
  const filtered = coinF !== "all" || resultF !== "all";
  return (
    <section className="yours-hist" aria-label="History">
      {t.rounds === 0 && !filtered ? (
        <div className="card yours-empty">
          <span className="yours-empty-ico"><PixelBell size={48} /></span>
          <div><h3>No rounds yet</h3><p className="dim">Every call you make and every house deposit lands here once its transaction is final, and stays after you collect.</p><Link className="btn btn-sm" to="/#floor">Pick a table <span aria-hidden="true">→</span></Link></div>
        </div>
      ) : <>
        <Totals totals={t} rates={rates} />
        {first.indexed && !first.indexed.complete && <p className="yours-note">Still reading older rounds from the chain; the list fills in as it goes.</p>}

        <div className="yours-hist-filters">
          <div className="yours-pills" role="group" aria-label="Result">
            {RESULTS.map(([k, label]) => <button key={k} className={resultF === k ? "on" : ""} aria-pressed={resultF === k} onClick={() => setResultF(k)}>{label}{k !== "all" && t.results[k] ? <span className="yours-count">{t.results[k]}</span> : null}</button>)}
          </div>
          {played.length > 1 && <div className="yours-coins" role="group" aria-label="Coin">
            <button className={coinF === "all" ? "on" : ""} aria-pressed={coinF === "all"} onClick={() => setCoinF("all")}>Every coin</button>
            {played.map((s) => { const c = COINS.find((x) => x.symbol === s); return <button key={s} className={coinF === s ? "on" : ""} aria-pressed={coinF === s} onClick={() => setCoinF(s)}>{c && <img src={c.logo} alt="" />}${s}</button>; })}
          </div>}
        </div>

        {rounds.length === 0
          ? <div className="card yours-empty yours-empty-sm"><div><h3>No rounds with these filters</h3><button className="btn btn-sm btn-ghost" onClick={() => { setCoinF("all"); setResultF("all"); }}>Show them all</button></div></div>
          : <div className="yours-tickets">{rounds.map((r) => <Ticket key={r.ladder} r={r} own={own} rates={rates} onCollect={onCollect} />)}</div>}

        {q.isFetchingNextPage && <div className="yours-tickets yours-tickets-more" aria-busy="true" aria-label="Reading older rounds">{[0, 1].map((i) => <div key={i} className="card yours-skel yours-skel-wide"><i /><i /><i /></div>)}</div>}
        {q.hasNextPage && !q.isFetchingNextPage && <div className="yours-more"><button className="btn btn-sm btn-ghost" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more ({first.matching - rounds.length} older)</button></div>}
        {moreFailed && <p className="yours-note">Could not read the next page. <button className="yours-link" onClick={() => void fetchMore()}>Try again</button></p>}
        <p className="yours-foot dimmer">Paid and got are what left and reached your wallet, the coins' transfer fees included. Amounts stay in each round's coin; ≈ dollars are at today's price.</p>
      </>}
    </section>
  );
}

/** Rounds played, paid, got back and net: big, coin first or dollars across coins. */
function Totals({ totals, rates }: { totals: Page["totals"]; rates: Record<string, number> }) {
  const coins = totals.coins.filter((c) => c.decimals !== null).map((c) => ({ ...c, k: coinOf(c.mint, c.coin) }));
  const cell = (label: string, pick: (c: CoinTotal) => bigint, tone = false, note?: string) => {
    const rows = coins.map((c) => ({ c, v: pick(c) })).filter((x) => x.v !== 0n);
    const priced = rows.filter((x) => x.c.k && rates[x.c.k.symbol] !== undefined);
    const usd = priced.reduce((a, x) => a + toUsd(x.v, x.c.decimals!, rates[x.c.k!.symbol]!), 0);
    const cls = tone ? (usd > 0 || (!priced.length && rows[0] && rows[0].v > 0n) ? "up" : usd < 0 || (!priced.length && rows[0] && rows[0].v < 0n) ? "down" : "") : "";
    return (
      <div className="card yours-tile">
        <div className="label">{label}</div>
        {rows.length === 0 ? <div className="yours-tile-v dimmer">0</div>
          : rows.length === 1 ? <>
            <div className={`yours-tile-v ${cls}`}>{priced.length ? `${tone && usd > 0 ? "+" : ""}${fmtUsd(usd)}` : `${tone ? signed(rows[0]!.v) : ""}${coinText(abs(rows[0]!.v), rows[0]!.c.decimals!, `$${rows[0]!.c.k?.symbol ?? rows[0]!.c.coin ?? ""}`)}`}</div>
            {priced.length > 0 && <div className="yours-tile-s">{tone ? signed(rows[0]!.v) : ""}{coinText(abs(rows[0]!.v), rows[0]!.c.decimals!, `$${rows[0]!.c.k?.symbol ?? rows[0]!.c.coin ?? ""}`)}</div>}
          </> : <>
            <div className={`yours-tile-v ${cls}`}>{priced.length ? `${tone && usd > 0 ? "+" : ""}${fmtUsd(usd)}` : "–"}</div>
            <div className="yours-chips">{rows.map((x) => <span key={x.c.mint} className={`yours-chip ${tone ? (x.v > 0n ? "up" : "down") : ""}`} title={`$${x.c.k?.symbol ?? x.c.coin ?? ""}`}>{x.c.k && <img src={x.c.k.logo} alt={`$${x.c.k.symbol}`} />}{tone ? signed(x.v) : ""}{fmtCompact(abs(x.v), x.c.decimals!)}</span>)}</div>
          </>}
        {note && <div className="yours-tile-s">{note}</div>}
      </div>
    );
  };
  const r = totals.results;
  const judged = r.won + r.missed;
  const atWork = totals.coins.some((c) => BigInt(c.atWork ?? "0") > 0n);
  const tally = [r.won && `${r.won} hit`, r.missed && `${r.missed} missed`, r.refunded && `${r.refunded} refunded`, r.unclaimed && `${r.unclaimed} to collect`, r.open && `${r.open} running`].filter(Boolean).join(" · ");
  return (
    <div className="yours-hist-tiles">
      <div className="card yours-tile"><div className="label">Rounds played</div><div className="yours-tile-v">{totals.rounds}</div><div className="yours-tile-s">{tally}</div></div>
      {cell("Paid in", (c) => BigInt(c.paid), false, "finished rounds")}
      {cell("Got back", (c) => BigInt(c.got), false, "finished rounds")}
      {/* The net sits in the hero above; here, how often a call hits. */}
      <div className="card yours-tile">
        <div className="label">Hit rate</div>
        <div className={`yours-tile-v ${judged ? "" : "dimmer"}`}>{judged ? `${Math.round((r.won / judged) * 100)}%` : "–"}</div>
        <div className="yours-tile-s">{judged ? `${r.won} of ${judged} finished ${judged === 1 ? "round" : "rounds"} hit` : "No finished rounds yet"}{atWork ? ` · ${r.open} running` : ""}</div>
      </div>
    </div>
  );
}

const VERB: Record<string, string> = {
  call: "Called", add: "Added to", sell: "Sold", collect: "Collected", refund: "Refunded", deposit: "House deposit",
  claim: "House payout", start: "Started the round", fees: "Starter's fee share", sweep: "Closed out", settle: "Settled", void: "Voided",
};

/** One round as a ticket: what it was on and the calls on the left, torn
 *  off at the perforation, the stamp and the net on the stub. */
function Ticket({ r, own, rates, onCollect }: { r: Round; own: boolean; rates: Record<string, number>; onCollect?: () => void }) {
  const [open, setOpen] = useState(false);
  const coin = coinOf(r.quoteMint, r.coin);
  const sym = `$${coin?.symbol ?? r.coin ?? ""}`;
  const dec = r.decimals ?? coin?.decimals ?? 6;
  const rate = coin ? rates[coin.symbol] ?? null : null;
  const paid = BigInt(r.paid), got = BigInt(r.got), net = BigInt(r.net);
  const money = (u: bigint) => coinText(u, dec, sym);
  const usd = (u: bigint, sign = "") => (rate === null ? null : <small>≈ {sign}{fmtUsd(toUsd(u, dec, rate))}</small>);
  const anchor = (coin ? anchorOf(coin).name : undefined) ?? r.feed?.name ?? "A round";
  const day = r.settlesAt ? nyWhen(r.settlesAt, { weekday: "short", month: "short", day: "numeric" }) : "";
  const outcome = r.status === "void" ? "void, everything refunded"
    : r.settled ? `closed ${r.settled.price ? `at ${px(r.settled.price)}` : `on ${px(r.settled.band)}`}`
    : r.status === "settling" ? "closed, settling" : r.settlesAt ? `closes ${nyWhen(r.settlesAt, { hour: "numeric", minute: "2-digit" })} New York` : "";
  const owed = r.owed ? BigInt(r.owed) : 0n;
  const acts = r.actions;
  // A round still to collect is judged on what it pays once collected.
  const shownNet = r.result === "unclaimed" ? net + owed : net;
  const stamp = stampOf(r.result, net);
  const waiting = r.result === "open" && got === 0n;
  // Still to collect, but the ledger cannot price it (a refund share, a house
  // deposit): no net until it lands, never "paid in full, lost".
  const unpriced = r.result === "unclaimed" && r.owed === null;
  const landed = r.result === "won" && r.calls.length > 0 ? "A call hit" : r.result === "missed" && r.calls.length > 0 ? "No call hit" : null;
  return (
    <article className={`yours-ticket yours-ticket-${stamp.tone}`}>
      <div className="yours-ticket-main">
        <header className="yours-ticket-head">
          {coin && <span className="yours-logos" aria-hidden="true"><img className="yours-logo-a" src={coin.anchor.logo} alt="" /><img className="yours-logo-c" src={coin.logo} alt="" /></span>}
          <div className="yours-call-id">
            <b>{anchor} <span className="dimmer">in {sym}</span></b>
            <span className="dimmer">{day}{outcome ? ` · ${outcome}` : ""}</span>
          </div>
        </header>
        {(r.calls.length > 0 || r.house) && <ul className="yours-ticket-calls">
          {r.calls.slice(0, CALLS_SHOWN).map((c) => <li key={c}><span className="yours-kind yours-kind-line">Call</span>{px(c)}</li>)}
          {r.calls.length > CALLS_SHOWN && <li className="dimmer">and {r.calls.length - CALLS_SHOWN} more {r.calls.length - CALLS_SHOWN === 1 ? "call" : "calls"}, in the entries</li>}
          {r.house && <li><span className="yours-kind yours-kind-house">House</span>deposit in the pool</li>}
        </ul>}
        <div className="yours-ticket-sums">
          <div><span>Paid</span><b>{money(paid)}</b>{usd(paid)}</div>
          {!waiting && <div><span>Got</span><b>{money(got)}</b>{usd(got)}</div>}
          {owed > 0n && <div><span>Still to collect</span><b className="taxi">{money(owed)}</b>{usd(owed)}</div>}
          {r.settled && <div><span>Landed on</span><b>{px(r.settled.band)}</b></div>}
        </div>
        <button className="yours-ticket-unfold" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {open ? "Fold the entries" : `${acts.length} ${acts.length === 1 ? "entry" : "entries"}`}
        </button>
      </div>

      <div className="yours-ticket-stub">
        <span className={`yours-stamp yours-stamp-${stamp.tone}`}>{stamp.text}</span>
        {waiting
          ? <div className="yours-stub-wait">Pays at the bell, if it lands</div>
          : unpriced
          ? <div className="yours-stub-wait yours-stub-wait-taxi">{r.status === "void" ? "Refund waiting" : "Payout waiting"}<small>Collect it to see what lands</small></div>
          : r.result === "open"
          ? <div className="yours-stub-net">
            <span className="label">Sold so far</span>
            <b>{money(got)}</b>
            {usd(got)}
            <span className="yours-stub-note">The rest pays at the bell, if it lands</span>
          </div>
          : <div className="yours-stub-net">
            <span className="label">{r.result === "unclaimed" ? "Net, once collected" : "Net"}</span>
            <b className={shownNet > 0n ? "up" : shownNet < 0n ? "down" : ""}>{signed(shownNet)}{money(abs(shownNet))}</b>
            {usd(abs(shownNet), signed(shownNet))}
          </div>}
        {landed && <span className="yours-stub-note">{landed}</span>}
        <div className="yours-stub-act">
          {r.claimable && own && (onCollect ? <button className="btn btn-sm" onClick={onCollect}>Collect</button> : <Link to={`/m/${r.ladder}`} className="btn btn-sm">Collect</Link>)}
          {r.claimable && !own && <span className="yours-stub-note">owed to this account</span>}
          <Link to={`/m/${r.ladder}`} className="yours-link">Open the round ›</Link>
        </div>
      </div>

      <div className="yours-ticket-acts">
        <Fold open={open}>
          <ol className="yours-acts">
            {acts.map((a, n) => {
              const out = BigInt(a.amountOut), inn = BigInt(a.amountIn);
              const amt = a.kind === "settle" || a.kind === "void" ? "" : a.kind === "sweep" ? "paid nothing" : out > 0n ? `+${money(out)}` : inn > 0n ? `−${money(inn)}` : a.kind === "collect" ? "nothing won" : "";
              return (
                <li key={`${a.sig}-${n}`}>
                  <span className="dimmer">{a.time ? nyWhen(a.time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
                  <span><b>{VERB[a.kind] ?? a.kind}</b>{a.name ? ` ${a.kind === "settle" ? "on " : ""}${px(a.name)}` : ""}{a.by ? <em className="dimmer"> · sent by a keeper</em> : null}</span>
                  <span className={out > 0n ? "up" : ""}>{amt}</span>
                  {a.sig ? <a className="yours-link" href={EXPLORER("tx", a.sig)} target="_blank" rel="noreferrer" aria-label="Open the transaction in the explorer" title="Open the transaction in the explorer">tx ↗</a> : <span />}
                </li>
              );
            })}
          </ol>
        </Fold>
      </div>
    </article>
  );
}

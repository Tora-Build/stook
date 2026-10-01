// History: every round a wallet played, finished ones too. Yours lists the
// accounts that still exist, and collecting closes them, so a round you
// collected leaves no trace there; this reads the ledger instead (infra/ledger,
// through the site's /history route): one paper receipt per round with what
// went in, what came back and how it ended, newest close first.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { COINS, coinByMint, type Coin } from "../lib/coins";
import { EXPLORER } from "../lib/config";
import { fmtCompact } from "../lib/format";
import { coinText, fmtUsd, toUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { Fold } from "./Fold";

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
const RESULTS: [Result | "all", string][] = [["all", "All"], ["won", "Won"], ["missed", "Missed"], ["refunded", "Refunded"], ["unclaimed", "To collect"], ["open", "Running"]];
const STAMP: Record<Result, string> = { won: "won", missed: "missed", refunded: "refunded", open: "running", unclaimed: "to collect" };

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
  return sym ? COINS.find((c) => c.symbol === sym) : undefined;
};
const abs = (v: bigint) => (v < 0n ? -v : v);
const signed = (v: bigint) => (v > 0n ? "+" : v < 0n ? "−" : "");

export function History({ wallet, own }: { wallet: PublicKey | null; own: boolean }) {
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
    <div className="hist-none">
      <p>Connect a wallet to see every round it played, collected ones included.</p>
      <WalletMultiButton>Connect a wallet</WalletMultiButton>
    </div>
  );
  if (q.isLoading) return <p className="stmt-empty">Reading the ledger…</p>;
  if (q.isError || !first) return (
    <div className="hist-error">
      <p>The history is out of reach right now. Your holdings are unaffected, and it will be back shortly.</p>
      <button className="pb-chip" onClick={() => void q.refetch()}>Try again</button>
    </div>
  );

  const t = first.totals;
  const filtered = coinF !== "all" || resultF !== "all";
  return (
    <section className="hist" aria-label="History">
      {t.rounds === 0 && !filtered ? (
        <div className="hist-empty">
          <p><b>No rounds yet.</b> Every call you make and every house deposit lands here once its transaction is final, and stays after you collect.</p>
          <Link className="stmt-step-go" to="/#floor">Pick a table ›</Link>
        </div>
      ) : <>
        <Totals totals={t} rates={rates} />
        {first.indexed && !first.indexed.complete && <p className="hist-note small">Still reading older rounds from the chain; the list fills in as it goes.</p>}

        <div className="pb-filters">
          <div className="seg seg-sm hist-results" role="group" aria-label="Result">
            {RESULTS.map(([k, label]) => <button key={k} className={resultF === k ? "on" : ""} aria-pressed={resultF === k} onClick={() => setResultF(k)}>{label}{k !== "all" && t.results[k] ? <span className="hist-count">{t.results[k]}</span> : null}</button>)}
          </div>
          {played.length > 1 && <div className="pb-coins" role="group" aria-label="Coin">
            <button className={`pb-chip ${coinF === "all" ? "on" : ""}`} aria-pressed={coinF === "all"} onClick={() => setCoinF("all")}>every coin</button>
            {played.map((s) => { const c = COINS.find((x) => x.symbol === s); return <button key={s} className={`pb-chip ${coinF === s ? "on" : ""}`} aria-pressed={coinF === s} onClick={() => setCoinF(s)}>{c && <img src={c.logo} alt="" />}${s}</button>; })}
          </div>}
        </div>

        {rounds.length === 0
          ? <p className="stmt-empty">No rounds with these filters. <button className="link" onClick={() => { setCoinF("all"); setResultF("all"); }}>Show them all</button></p>
          : <div className="hist-list">{rounds.map((r) => <Receipt key={r.ladder} r={r} own={own} rates={rates} />)}</div>}

        {q.hasNextPage && <div className="hist-more"><button className="pb-chip" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? "Reading…" : `Load more (${first.matching - rounds.length} older)`}</button></div>}
        {moreFailed && <p className="hist-note small">Could not read the next page. <button className="link" onClick={() => void fetchMore()}>Try again</button></p>}
        <p className="stmt-foot">Paid and got are what left and reached your wallet, the coins' transfer fees included. Amounts stay in each round's coin; ≈ dollars are at today's price.</p>
      </>}
    </section>
  );
}

/** Rounds played, paid, got back and net: coin first, ≈ dollars beneath. */
function Totals({ totals, rates }: { totals: Page["totals"]; rates: Record<string, number> }) {
  const coins = totals.coins.filter((c) => c.decimals !== null).map((c) => ({ ...c, k: coinOf(c.mint, c.coin) }));
  const cell = (label: string, pick: (c: CoinTotal) => bigint, tone = false, note?: string) => {
    const rows = coins.map((c) => ({ c, v: pick(c) })).filter((x) => x.v !== 0n);
    const priced = rows.filter((x) => x.c.k && rates[x.c.k.symbol] !== undefined);
    const usd = priced.reduce((a, x) => a + toUsd(x.v, x.c.decimals!, rates[x.c.k!.symbol]!), 0);
    const cls = tone ? (usd > 0 || (!priced.length && rows[0] && rows[0].v > 0n) ? "up" : usd < 0 || (!priced.length && rows[0] && rows[0].v < 0n) ? "down" : "") : "";
    return (
      <div className="tote-cell">
        <div className="tote-k">{label}</div>
        {rows.length === 0 ? <div className="tote-v mono muted">0</div>
          : rows.length === 1 ? <>
            <div className={`tote-v mono ${cls}`}>{tone ? signed(rows[0]!.v) : ""}{coinText(abs(rows[0]!.v), rows[0]!.c.decimals!, `$${rows[0]!.c.k?.symbol ?? rows[0]!.c.coin ?? ""}`)}</div>
            {priced.length > 0 && <div className="tote-c mono">≈ {tone && usd > 0 ? "+" : ""}{fmtUsd(usd)}</div>}
          </> : <>
            <div className="tote-coins">{rows.map((x) => <span key={x.c.mint} className={`tote-chip mono ${tone ? (x.v > 0n ? "up" : "down") : ""}`} title={`$${x.c.k?.symbol ?? x.c.coin ?? ""}`}>{x.c.k && <img src={x.c.k.logo} alt={`$${x.c.k.symbol}`} />}{tone ? signed(x.v) : ""}{fmtCompact(abs(x.v), x.c.decimals!)}</span>)}</div>
            {priced.length > 0 && <div className={`tote-c mono ${cls}`}>≈ {tone && usd > 0 ? "+" : ""}{fmtUsd(usd)} in all</div>}
          </>}
        {note && <div className="tote-c hist-tote-note">{note}</div>}
      </div>
    );
  };
  const r = totals.results;
  const atWork = totals.coins.some((c) => BigInt(c.atWork ?? "0") > 0n);
  const tally = [r.won && `${r.won} won`, r.missed && `${r.missed} missed`, r.refunded && `${r.refunded} refunded`, r.unclaimed && `${r.unclaimed} to collect`, r.open && `${r.open} running`].filter(Boolean).join(" · ");
  return (
    <section className="tote hist-tote">
      <div className="tote-cell"><div className="tote-k">rounds played</div><div className="tote-v mono">{totals.rounds}</div><div className="tote-c">{tally}</div></div>
      {cell("paid in", (c) => BigInt(c.paid), false, "finished rounds")}
      {cell("got back", (c) => BigInt(c.got), false, "finished rounds")}
      {cell("net", (c) => BigInt(c.net), true, atWork ? `${r.open} running ${r.open === 1 ? "round" : "rounds"} not counted yet` : undefined)}
    </section>
  );
}

const VERB: Record<string, string> = {
  call: "Called", add: "Added to", sell: "Sold", collect: "Collected", refund: "Refunded", deposit: "House deposit",
  claim: "House payout", start: "Started the round", fees: "Starter's fee share", sweep: "Closed out", settle: "Settled", void: "Voided",
};

/** One round on paper: what it was on, the calls, paid and got, the result. */
function Receipt({ r, own, rates }: { r: Round; own: boolean; rates: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const coin = coinOf(r.quoteMint, r.coin);
  const sym = `$${coin?.symbol ?? r.coin ?? ""}`;
  const dec = r.decimals ?? coin?.decimals ?? 6;
  const rate = coin ? rates[coin.symbol] ?? null : null;
  const paid = BigInt(r.paid), got = BigInt(r.got), net = BigInt(r.net);
  const money = (u: bigint) => coinText(u, dec, sym);
  const usd = (u: bigint, sign = "") => (rate === null ? null : <small className="hr-usd">≈ {sign}{fmtUsd(toUsd(u, dec, rate))}</small>);
  const anchor = coin?.anchor.name ?? r.feed?.name ?? "A round";
  const day = r.settlesAt ? nyWhen(r.settlesAt, { weekday: "short", month: "short", day: "numeric" }) : "";
  const outcome = r.status === "void" ? "void, everything refunded"
    : r.settled ? `closed ${r.settled.price ? `at ${r.settled.price}` : `on ${r.settled.band}`}`
    : r.status === "settling" ? "closed, settling" : r.settlesAt ? `closes ${nyWhen(r.settlesAt, { hour: "numeric", minute: "2-digit" })} New York` : "";
  const owed = r.owed ? BigInt(r.owed) : 0n;
  const acts = r.actions;
  return (
    <article className={`hist-receipt hr-${r.result}`}>
      <div className="hr-paper">
        <header className="hr-head">
          {coin && <span className="logos logos-anchor-first"><img src={coin.anchor.logo} alt="" className="logo-coin" /><img src={coin.logo} alt="" className="logo-anchor" /></span>}
          <div className="hr-id">
            <b>{anchor} <span className="hr-in">in {sym}</span></b>
            <span className="hr-when">{day}{outcome ? ` · ${outcome}` : ""}</span>
          </div>
          <span className={`hr-stamp hs-${r.result}`}>{STAMP[r.result]}</span>
        </header>

        {(r.calls.length > 0 || r.house) && <ul className="hr-calls">
          {r.calls.slice(0, CALLS_SHOWN).map((c) => <li key={c}><span className="hr-tag">call</span>{c}</li>)}
          {r.calls.length > CALLS_SHOWN && <li className="hr-more">and {r.calls.length - CALLS_SHOWN} more {r.calls.length - CALLS_SHOWN === 1 ? "call" : "calls"}, in the entries</li>}
          {r.house && <li><span className="hr-tag hr-tag-house">house</span>deposit in the pool</li>}
        </ul>}
        {r.settled && <div className="hr-band">landed on <b>{r.settled.band}</b></div>}

        <div className="hr-sums">
          <div className="hr-sum"><span>paid</span><i /><b className="mono">{money(paid)}</b>{usd(paid)}</div>
          {r.result === "open" && got === 0n
            ? <div className="hr-sum hr-wait"><span>pays at the bell, if it lands</span></div>
            : <>
              <div className="hr-sum"><span>got</span><i /><b className="mono">{money(got)}</b>{usd(got)}</div>
              <div className={`hr-sum hr-net ${net > 0n ? "up" : net < 0n ? "down" : ""}`}><span>{r.result === "open" ? "so far" : "net"}</span><i /><b className="mono">{signed(net)}{money(abs(net))}</b>{usd(abs(net), signed(net))}</div>
            </>}
          {owed > 0n && <div className="hr-sum hr-owed"><span>still to collect</span><i /><b className="mono">{money(owed)}</b>{usd(owed)}</div>}
        </div>

        <button className="hr-unfold" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {open ? "Fold the entries" : `${acts.length} ${acts.length === 1 ? "entry" : "entries"}`}
        </button>
        <Fold open={open}>
          <ol className="hr-acts">
            {acts.map((a, n) => {
              const out = BigInt(a.amountOut), inn = BigInt(a.amountIn);
              const amt = a.kind === "settle" || a.kind === "void" ? "" : a.kind === "sweep" ? "paid nothing" : out > 0n ? `+${money(out)}` : inn > 0n ? `−${money(inn)}` : a.kind === "collect" ? "nothing won" : "";
              return (
                <li key={`${a.sig}-${n}`}>
                  <span className="ha-time mono">{a.time ? nyWhen(a.time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
                  <span className="ha-what"><b>{VERB[a.kind] ?? a.kind}</b>{a.name ? ` ${a.kind === "settle" ? "on " : ""}${a.name}` : ""}{a.by ? <em> · sent by a keeper</em> : null}</span>
                  <span className={`ha-amt mono ${out > 0n ? "up" : ""}`}>{amt}</span>
                  {a.sig ? <a className="ha-tx" href={EXPLORER("tx", a.sig)} target="_blank" rel="noreferrer" aria-label="Open the transaction in the explorer" title="Open the transaction in the explorer">tx ↗</a> : <span className="ha-tx" />}
                </li>
              );
            })}
          </ol>
        </Fold>

        <footer className="hr-foot">
          <Link to={`/m/${r.ladder}`} className="hr-link">Open the round ›</Link>
          {r.claimable && own && <Link to={`/m/${r.ladder}`} className="hr-collect">Collect ›</Link>}
          {r.claimable && !own && <span className="hr-dim">owed to this account</span>}
        </footer>
      </div>
    </article>
  );
}

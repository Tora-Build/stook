// Yours: a player's desk. The street with a tower lit by their open calls,
// the four numbers that matter, then four tabs: open calls, ready to collect,
// in the house, and every round they ever played. Amounts stay in each
// round's own coin; dollars are an estimate at today's price, used to add
// coins up, never sent anywhere.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHoldings, useSend } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { fetchMint } from "../lib/chain";
import { collectPlan, collectTxs } from "../lib/collect";
import { COINS, anchorOf, coinByMint } from "../lib/coins";
import { useUsdRates } from "../lib/usd";
import { Title } from "../components/Title";
import { History } from "../components/History";
import { YoursHero, type HeroNums } from "../components/yours/YoursHero";
import { CallCard } from "../components/yours/CallCard";
import { CollectDesk, slipOf } from "../components/yours/CollectDesk";
import { HouseShelf } from "../components/yours/HouseShelf";
import { Empty, FirstSteps, Invite, Skeleton, Trouble } from "../components/yours/Invite";
import { useStakes } from "../components/yours/useStakes";
import { PixelCall, PixelCoins } from "../components/yours/art";
import { addTo, symOf, value, type Pot } from "../components/yours/model";

type Tab = "calls" | "collect" | "house" | "history";
const TABS: Tab[] = ["calls", "collect", "house", "history"];

/** Calls you can still act on first, then those waiting for the bell. */
const order = (h: { ladder: { status: string; locksAt: bigint; settlesAt: bigint } }, now: number) =>
  (h.ladder.status === "open" && now < Number(h.ladder.locksAt) ? 0 : now < Number(h.ladder.settlesAt) ? 1e12 : 2e12) + Number(h.ladder.settlesAt);

const INTRO: Record<"calls" | "collect" | "house", string> = {
  calls: "A live call can be sold any time before trading closes. After that it waits for the 4 PM New York bell and pays if the price lands in its range.",
  collect: "These rounds have rung their bell. What they pay sits in the round until you collect it to your wallet.",
  house: "The house takes the other side of every call and keeps 90% of the fees. A stake works every day's round until you withdraw.",
};

interface Totals { rounds: number; results?: Record<string, number>; coins: { mint: string | null; coin: string | null; decimals: number | null; net: string; owed?: string }[] }

export function Yours() {
  const { publicKey: wallet } = useWallet();
  // `?account=` reads any address's desk, read-only: holdings are public on
  // chain, and only the connected wallet gets the buttons that send.
  const [params, setParams] = useSearchParams();
  const viewed = useMemo(() => { try { const a = params.get("account"); return a ? new PublicKey(a) : null; } catch { return null; } }, [params]);
  const publicKey = viewed ?? wallet;
  const own = !!wallet && !!publicKey && wallet.equals(publicKey);
  const now = useNow();
  const holdings = useHoldings(publicKey ?? null);
  const stakesQ = useStakes(publicKey ?? null);
  const stakes = stakesQ.data ?? [];
  const rates = useUsdRates().data ?? {};
  const rounds = useMemo(() => [...(holdings.data ?? [])].sort((a, b) => Number(a.ladder.settlesAt - b.ladder.settlesAt)), [holdings.data]);

  // The ledger's totals, for the net on finished rounds (one small read).
  const acct = publicKey?.toBase58() ?? "";
  const totals = useQuery({
    queryKey: ["history-totals", acct],
    enabled: !!publicKey,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Totals> => { const r = await fetch(`/history?wallet=${acct}&limit=1`); if (!r.ok) throw new Error(`history ${r.status}`); return (await r.json()).totals; },
  });

  // Every finished round the wallet holds anything in: the slip lists these,
  // and "Collect all" collects these, whatever the filters show.
  const finished = collectPlan(rounds);
  const running = rounds.filter((h) => !finished.includes(h));

  // The coin filter, for every tab but History (which has its own).
  // A pick that no longer matches anything held (all of it collected, or
  // another account) falls back to every coin, so no tab reads empty for it.
  const [coinPick, setCoinF] = useState("all");
  const coinsHeld = [...new Set([...rounds.map(symOf), ...stakes.map((s) => s.coin.symbol)])].filter((s) => s !== "tokens");
  const coinF = coinsHeld.length > 1 && coinsHeld.includes(coinPick) ? coinPick : "all";
  useEffect(() => { setCoinF("all"); }, [acct]);
  const pass = (sym: string) => coinF === "all" || sym === coinF;

  // Open calls: every line still at work, newest bell last.
  const calls = running.flatMap((h) => {
    const c = coinByMint(h.ladder.quoteMint), v = value(h, now, c ? anchorOf(c).dp : 2);
    return v.lines.filter((x) => x.kind === "line").map((line) => ({ h, line, sym: c?.symbol ?? "tokens" }));
  }).sort((a, b) => order(a.h, now) - order(b.h, now));

  // The hero's numbers.
  const nums: HeroNums | null = publicKey && !holdings.isLoading && !holdings.isError ? (() => {
    const ready: Pot = new Map(), worth: Pot = new Map(), paid: Pot = new Map(), house: Pot = new Map();
    for (const h of rounds) {
      const sym = symOf(h), dec = h.ladder.decimals, c = coinByMint(h.ladder.quoteMint), v = value(h, now, c ? anchorOf(c).dp : 2);
      addTo(ready, sym, dec, v.ready); addTo(house, sym, dec, v.inHouse);
      for (const x of v.lines) if (x.kind === "line" && !finished.includes(h)) { addTo(paid, sym, dec, x.cost); if (x.value !== null) addTo(worth, sym, dec, x.value); }
    }
    for (const s of stakes) addTo(house, s.coin.symbol, s.coin.decimals, s.mine.value + s.mine.queuedDeposit);
    const t = totals.data;
    let net: HeroNums["net"] = null;
    if (t) {
      const pot: Pot = new Map();
      for (const c of t.coins) {
        if (c.decimals === null) continue;
        let sym = c.coin ?? "";
        try { if (c.mint) sym = coinByMint(new PublicKey(c.mint))?.symbol ?? sym; } catch { /* not an address */ }
        sym = COINS.find((k) => k.symbol === sym || k.key === sym)?.symbol ?? sym;
        // What a finished round still owes counts too: before it is
        // collected it is not a loss.
        addTo(pot, sym, c.decimals, BigInt(c.net) + BigInt(c.owed ?? "0"));
      }
      net = { pot, rounds: t.rounds, waiting: t.results?.unclaimed ?? 0 };
    }
    const bells = running.map((h) => Number(h.ladder.settlesAt)).filter((x) => x > now);
    return { nextBell: calls.length && bells.length ? Math.min(...bells) : null, calls: calls.length, ready, readyRounds: finished.length, worth, paid, held: calls.filter((x) => x.line.value === null).length, house, stakes: stakes.length, net };
  })() : null;

  // Tabs, in the address (?tab=). With none picked, open where the money is.
  const picked = params.get("tab") as Tab | null;
  const auto: Tab = finished.length ? "collect" : calls.length ? "calls" : stakes.length || running.some((h) => h.tranches.length) ? "house" : "calls";
  const tab: Tab = picked && TABS.includes(picked) ? picked : auto;
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params); p.set("tab", t); setParams(p, { replace: true });
    if (t !== tab) document.getElementById("yours-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // One button collects every finished round, one after another, each sent
  // exactly as its own Collect would send it.
  const { connection } = useConnection();
  const qc = useQueryClient();
  const sendCollect = useSend("Collected"), sendRefund = useSend("Refunded");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const collectAll = async () => {
    if (!own || !wallet) return;
    const plan = finished;
    for (let n = 0; n < plan.length; n++) {
      setProgress([n + 1, plan.length]);
      const h = plan[n]!, send = h.ladder.status === "void" ? sendRefund : sendCollect;
      try {
        const mint = await qc.fetchQuery({ queryKey: ["mint", h.ladder.quoteMint.toBase58()], queryFn: () => fetchMint(connection, h.ladder.quoteMint), staleTime: Infinity });
        if (!mint) continue;
        for (const tx of collectTxs(h, wallet, mint.tokenProgram)) await send.mutateAsync(tx);
      } catch { /* the toast has said why; on to the next round */ }
    }
    setProgress(null);
  };

  const slip = slipOf(finished.filter((h) => pass(symOf(h))), now, rates);
  const shownCalls = calls.filter((x) => pass(x.sym));
  const houseRounds = running.filter((h) => pass(symOf(h)));
  const houseStakes = stakes.filter((s) => pass(s.coin.symbol));
  const houseCount = stakes.length + running.filter((h) => h.tranches.length).length;
  const count: Record<Tab, number | null> = { calls: calls.length, collect: finished.length, house: houseCount, history: totals.data?.rounds ?? null };
  const LABEL: Record<Tab, string> = { calls: "Open calls", collect: "Ready to collect", house: "In the house", history: "History" };

  const empty = publicKey && !holdings.isLoading && !holdings.isError && rounds.length === 0 && stakes.length === 0 && !stakesQ.isLoading;

  return (
    <div className="yours">
      <Title text="Your desk" />
      <YoursHero account={publicKey ?? null} own={own} nums={empty ? null : nums} loading={!!publicKey && !holdings.isError && (holdings.isLoading || (!empty && !nums))} now={now} rates={rates} progress={progress} onCollectAll={() => void collectAll()} onTab={setTab} />

      <div className="wrap yours-body">
        {!publicKey ? <Invite />
          : holdings.isError ? <Trouble onRetry={() => void holdings.refetch()} />
          : holdings.isLoading ? <><div className="yours-tabs yours-tabs-wait" /><Skeleton /></>
          : <>
            {!empty && <div className="yours-bar" id="yours-tabs">
              <div className="yours-tabs" role="tablist" aria-label="Your desk">
                {TABS.map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                    {LABEL[t]}{count[t] ? <span className={`yours-count ${t === "collect" ? "yours-count-up" : ""}`}>{count[t]}</span> : null}
                  </button>
                ))}
              </div>
              {tab !== "history" && coinsHeld.length > 1 && <div className="yours-coins" role="group" aria-label="Coin">
                <button className={coinF === "all" ? "on" : ""} aria-pressed={coinF === "all"} onClick={() => setCoinF("all")}>Every coin</button>
                {coinsHeld.map((s) => { const c = COINS.find((x) => x.symbol === s); return <button key={s} className={coinF === s ? "on" : ""} aria-pressed={coinF === s} onClick={() => setCoinF(s)}>{c && <img src={c.logo} alt="" />}${s}</button>; })}
              </div>}
            </div>}

            {tab !== "history" && !empty && !(tab === "house" && !houseCount) && <p className="yours-intro dim">{INTRO[tab]}</p>}
            {tab === "history" ? <History wallet={publicKey} own={own} onCollect={() => setTab("collect")} />
              : empty ? <FirstSteps />
              : tab === "calls" ? (shownCalls.length
                ? <div className="yours-grid">{shownCalls.map((x) => <CallCard key={x.line.key} h={x.h} line={x.line} now={now} rate={rates[x.sym] ?? null} />)}</div>
                : <Empty art={<PixelCall size={48} />} title={coinF === "all" ? "No calls running" : `No $${coinF} calls running`} line="Pick a table and call where today's price closes. The closer you are, the more it pays." to="/#floor" cta="Pick a table" />)
              : tab === "collect" ? (slip.length
                ? <CollectDesk slip={slip} now={now} own={own} progress={progress} onCollectAll={() => void collectAll()} />
                : <Empty art={<PixelCoins size={48} />} title="Nothing to collect" line="When a round you are in rings its bell, what it pays waits here until you collect it." to="/#floor" cta={calls.length ? "See your open calls" : "Pick a table"} onGo={calls.length ? () => setTab("calls") : undefined} />)
              : <HouseShelf stakes={houseStakes} rounds={houseRounds} now={now} own={own} rates={rates} />}

            {tab !== "history" && !empty && <p className="yours-foot dimmer">Amounts are in each round's coin; ≈ dollars move with today's price. Thirty days after a close, anyone may send what a round owes you to your wallet.</p>}
          </>}
      </div>
    </div>
  );
}


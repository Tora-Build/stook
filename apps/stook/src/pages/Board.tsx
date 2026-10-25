// The Board: the street's sharpest callers in each coin, and how each coin's
// house has done. Callers come from the ledger (infra/ledger, through the
// site's /leaderboard route): every settled round a wallet made a call in,
// best net first. The houses are read from chain.
import { useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { COINS, mintOf, seriesOf, type Coin } from "../lib/coins";
import { fmtCompact, short } from "../lib/format";
import { fmtUsd, toUsd, useUsdRates } from "../lib/usd";
import { nyWhen } from "../lib/time";
import { Title } from "../components/Title";

interface Player { rank: number; wallet: string; bot: string | null; rounds: number; won: number; missed: number; hit: number; paid: string; back: string; net: string; best: string; last: number }
interface Board { coin: string; decimals: number | null; days: number; players: number; people: number; board: Player[]; peopleBoard: Player[]; scoredAt: number; indexed?: { through: number | null; complete: boolean } }

// The table style right-aligns every column after the first; names read from the left.
const LEFT = { textAlign: "left" } as const;
const PERIODS: [number, string][] = [[7, "This week"], [30, "30 days"], [0, "All time"]];

async function fetchBoard(coin: string, days: number): Promise<Board> {
  const r = await fetch(`/leaderboard?${new URLSearchParams({ coin, days: String(days), limit: "25" })}`);
  if (!r.ok) throw new Error(`leaderboard ${r.status}`);
  return r.json();
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const signed = (v: bigint) => (v > 0n ? "+" : v < 0n ? "−" : "");

export function BoardPage() {
  const [coin, setCoin] = useState<Coin>(COINS[0]!);
  const [days, setDays] = useState(7);
  const [people, setPeople] = useState(false);
  const { publicKey } = useWallet();
  const me = publicKey?.toBase58();
  const q = useQuery({ queryKey: ["board", coin.symbol, days], queryFn: () => fetchBoard(coin.symbol, days), staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const rates = useUsdRates().data ?? {};
  const rate = rates[coin.symbol] ?? null;
  const b = q.data;
  const dec = b?.decimals ?? coin.decimals;
  const list = b ? (people ? b.peopleBoard : b.board) : [];
  const money = (u: bigint, sign = false) => `${sign ? signed(u) : ""}${fmtCompact(abs(u), dec)} $${coin.symbol}`;

  return (
    <div className="page">
      <Title text="The Board" />
      <h1>The Board</h1>
      <p className="muted">The street's sharpest callers, coin by coin. A caller's record is every settled round they made a call in: a win when a call paid, a miss when none did. Best net first.</p>

      <div className="pb-filters">
        <div className="pb-coins" role="group" aria-label="Coin">
          {COINS.map((c) => <button key={c.symbol} className={`pb-chip ${coin.symbol === c.symbol ? "on" : ""}`} aria-pressed={coin.symbol === c.symbol} onClick={() => setCoin(c)}><img src={c.logo} alt="" />${c.symbol}</button>)}
        </div>
        <div className="seg seg-sm" role="group" aria-label="Period">
          {PERIODS.map(([d, label]) => <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>)}
        </div>
        <label className="small"><input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} /> Hide the sim's bots</label>
      </div>

      <section className="panel" aria-label={`Callers in $${coin.symbol}`}>
        {q.isLoading ? <p className="stmt-empty">Reading the ledger…</p>
          : q.isError || !b ? <p className="stmt-empty">The board is out of reach right now. It will be back shortly. <button className="link" onClick={() => void q.refetch()}>Try again</button></p>
          : list.length === 0 ? <p className="stmt-empty">{people && b.players > 0 ? "Only the sim's bots have called here in this period." : "No settled calls here in this period yet."} <Link to={`/c/${coin.symbol}`}>Make the first call ›</Link></p>
          : <table className="ladder-table">
            <thead><tr><th>#</th><th style={LEFT}>Caller</th><th>Rounds</th><th>Hit</th><th>Net, ${coin.symbol}</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const net = BigInt(p.net), best = BigInt(p.best);
                return (
                  <tr key={p.wallet} className={p.wallet === me ? "on" : ""}>
                    <td className="mono">{p.rank}</td>
                    <td style={LEFT}>
                      <Link to={`/yours?account=${p.wallet}&tab=history`} className="mono" title={p.wallet}>{short(new PublicKey(p.wallet))}</Link>
                      {p.wallet === me && <b> you</b>}
                      {p.bot && <div className="small muted" title="A wallet the devnet sim runs">bot · {p.bot}</div>}
                    </td>
                    <td className="mono">{p.rounds}</td>
                    <td className="mono" title={`${p.won} won, ${p.missed} missed`}>{Math.round(p.hit * 100)}%</td>
                    <td className={`mono ${net > 0n ? "up" : net < 0n ? "down" : ""}`} title={`Best round ${money(best, true)}`}>{signed(net)}{fmtCompact(abs(net), dec)}{rate !== null && <div className="small muted">≈ {signed(net)}{fmtUsd(toUsd(abs(net), dec, rate))}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>}
        {b && <p className="stmt-foot">
          {b.players} {b.players === 1 ? "caller" : "callers"} in this period, {b.people} of them people, the rest the devnet sim's bots. Net counts what came back and what is still to collect, less what went in; voided rounds and house deposits do not count. Tap a caller to see their rounds.
          {b.scoredAt ? ` Scored ${nyWhen(b.scoredAt, { hour: "numeric", minute: "2-digit" })} New York.` : ""}
        </p>}
      </section>

      <Houses rates={rates} />
    </div>
  );
}

/** Each coin's house: what it holds, how many rounds it has rolled, and what a share has made since it opened. */
function Houses({ rates }: { rates: Record<string, number> }) {
  const { connection } = useConnection();
  const coins = COINS.map((c) => ({ c, series: seriesOf(c), mint: mintOf(c) })).filter((x) => x.series && x.mint);
  const q = useQuery({
    queryKey: ["houses", coins.map((x) => x.series!.toBase58()).join()],
    queryFn: async () => {
      const keys = coins.map((x) => stook.deriveHouse(x.series!));
      const [houses, mints] = await Promise.all([connection.getMultipleAccountsInfo(keys), connection.getMultipleAccountsInfo(coins.map((x) => x.mint!))]);
      return coins.map((x, n) => ({ ...x, h: houses[n] ? stook.decodeHouse(houses[n]!.data) : null, decimals: mints[n]?.data[44] ?? x.c.decimals }));
    },
    refetchInterval: 60_000,
  });
  const rows = (q.data ?? []).filter((x) => x.h);
  if (!rows.length) return null;
  return (
    <section className="panel" aria-label="The houses">
      <h3>The houses</h3>
      <p className="hint">One house per coin funds every round of that coin and rolls from one round to the next. It wins what callers miss and pays what they hit; 90% of the trading fees go to it.</p>
      <table className="ladder-table">
        <thead><tr><th>House</th><th>Holds</th><th>Rounds rolled</th><th>A share since it opened</th></tr></thead>
        <tbody>
          {rows.map(({ c, h, decimals }) => {
            const capital = stook.houseCapital(h!);
            // A share's worth, (capital + 1) / (shares + V), against the 1 / V a share started at.
            const change = (Number(capital + 1n) * Number(stook.VIRTUAL_SHARES)) / Number(h!.totalShares + stook.VIRTUAL_SHARES) - 1;
            const rate = rates[c.symbol];
            return (
              <tr key={c.symbol}>
                <td><Link to={`/c/${c.symbol}`} className="pb-chip"><img src={c.logo} alt="" />${c.symbol}</Link></td>
                <td className="mono">{fmtCompact(capital, decimals)} ${c.symbol}{rate !== undefined && <div className="small muted">≈ {fmtUsd(toUsd(capital, decimals, rate))}</div>}</td>
                <td className="mono">{h!.epoch}</td>
                <td className={`mono ${change > 0.0005 ? "up" : change < -0.0005 ? "down" : ""}`}>{change > 0 ? "+" : change < 0 ? "−" : ""}{Math.abs(change * 100).toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

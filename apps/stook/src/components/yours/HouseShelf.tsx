// In the house: each coin's house stake (its worth, what waits to join or
// leave after the round, what is ready to claim) and every house deposit
// still at work in a round.
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import type { Holding } from "../../lib/chain";
import { ataOf, ensureAta } from "../../lib/chain";
import { anchorOf, coinByMint, coinPath } from "../../lib/coins";
import { useMint, useSend } from "../../hooks/useChain";
import { coinText, fmtUsd, toUsd } from "../../lib/usd";
import { nyWhen } from "../../lib/time";
import { PixelVault } from "./art";
import { STAGE_TEXT, stageOf, value } from "./model";
import type { Stake } from "./useStakes";

export function HouseShelf({ stakes, rounds, now, own, rates }: { stakes: Stake[]; rounds: Holding[]; now: number; own: boolean; rates: Record<string, number> }) {
  const deps = rounds.filter((h) => h.tranches.length > 0);
  if (!stakes.length && !deps.length) return (
    <div className="card yours-empty">
      <PixelVault className="yours-empty-art" />
      <div>
        <span className="kicker taxi">THE HOUSE</span>
        <h3>Nothing in the house yet</h3>
        <p className="dim">The house takes the other side of every call and keeps <b className="taxi">90% of the fees</b>. Stake a coin and it works every day's round.</p>
        <Link className="btn btn-sm" to="/c/STOOK#house">Back the house <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  );
  return (
    <div className="yours-house">
      {stakes.length > 0 && <div className="yours-grid">{stakes.map((s) => <StakeCard key={s.house.toBase58()} s={s} own={own} rate={rates[s.coin.symbol] ?? null} />)}</div>}
      {deps.length > 0 && <>
        <h3 className="yours-sub-h">Deposits in a round <span className="dimmer">settled at the bell</span></h3>
        <div className="yours-grid">{deps.map((h) => <DepositCard key={h.pubkey.toBase58()} h={h} now={now} rate={(() => { const c = coinByMint(h.ladder.quoteMint); return c ? rates[c.symbol] ?? null : null; })()} />)}</div>
      </>}
    </div>
  );
}

function StakeCard({ s, own, rate }: { s: Stake; own: boolean; rate: number | null }) {
  const { publicKey } = useWallet();
  const { coin, h, mine } = s;
  const info = useMint(own ? s.h.quoteMint : null).data;
  const claim = useSend("Claimed");
  const dec = coin.decimals, sym = `$${coin.symbol}`;
  const money = (u: bigint) => (rate !== null ? fmtUsd(toUsd(u, dec, rate)) : coinText(u, dec, sym));
  const share = h.totalShares > 0n ? Number((mine.shares * 10_000n) / h.totalShares) / 100 : 0;
  const busy = h.round !== null;
  const epoch = stook.epochFor(s.house, h, s.s);
  const canClaim = mine.claimable > 0n || (!!epoch && mine.queuedShares > 0n);
  const doClaim = () => {
    if (!publicKey || !info) return;
    const ata = ataOf(h.quoteMint, publicKey, info.tokenProgram);
    claim.mutate([ensureAta(h.quoteMint, publicKey, info.tokenProgram), stook.houseClaimIx({ house: s.house, quoteMint: h.quoteMint, tokenProgram: info.tokenProgram }, publicKey, ata, epoch)]);
  };
  return (
    <article className="card yours-stake">
      <header className="yours-call-head">
        <span className="yours-logos" aria-hidden="true"><img className="yours-logo-a" src={coin.logo} alt="" /></span>
        <div className="yours-call-id"><b>The {sym} house</b><span className="dimmer">{busy ? "Working today's round" : "Waiting for the next round"}</span></div>
        <span className="yours-stage yours-stage-house">Stake</span>
      </header>
      <div className="yours-stake-v">{money(mine.value)}</div>
      <div className="dimmer yours-stake-s">{rate !== null && <span>{coinText(mine.value, dec, sym)}</span>}<span>{share > 0 && share < 0.1 ? "under 0.1%" : `${share.toFixed(1)}%`} of the house</span>{busy && <span>at what went in</span>}</div>
      {(mine.queuedDeposit > 0n || mine.queuedShares > 0n || mine.claimable > 0n) && <dl className="yours-rows">
        {mine.queuedDeposit > 0n && <div><dt>Joins after the round</dt><dd>{coinText(mine.queuedDeposit, dec, sym)}</dd></div>}
        {mine.queuedShares > 0n && <div><dt>Leaves after the round</dt><dd>{mine.shares > 0n ? `${Math.min(100, Math.round((Number(mine.queuedShares) / Number(mine.shares)) * 100))}% of your stake` : "Your queued withdrawal"}</dd></div>}
        {mine.claimable > 0n && <div><dt>Ready to claim</dt><dd className="up">{coinText(mine.claimable, dec, sym)}</dd></div>}
      </dl>}
      <footer className="yours-call-foot">
        {own && canClaim
          ? <button className="btn btn-sm" disabled={!info || claim.isPending} onClick={doClaim}>{claim.isPending ? "Claiming…" : mine.claimable > 0n ? `Claim ${money(mine.claimable)}` : "Claim your withdrawal"}</button>
          : <span className="dimmer yours-clock-word">Keeps 90% of every fee</span>}
        <Link className="btn btn-sm btn-ghost" to={`${coinPath(coin)}#house`}>Add or withdraw <span aria-hidden="true">→</span></Link>
      </footer>
    </article>
  );
}

function DepositCard({ h, now, rate }: { h: Holding; now: number; rate: number | null }) {
  const l = h.ladder, coin = coinByMint(l.quoteMint), stage = stageOf(l, now);
  const v = value(h, now, coin ? anchorOf(coin).dp : 2), sym = coin ? `$${coin.symbol}` : "";
  const money = (u: bigint) => (rate !== null ? fmtUsd(toUsd(u, l.decimals, rate)) : coinText(u, l.decimals, sym));
  const lines = v.lines.filter((x) => x.kind === "house");
  const put = lines.reduce((a, x) => a + x.cost, 0n), fees = lines.reduce((a, x) => a + (x.fees ?? 0n), 0n);
  return (
    <article className="card yours-stake">
      <header className="yours-call-head">
        {coin && <span className="yours-logos" aria-hidden="true"><img className="yours-logo-a" src={coin.anchor.logo} alt="" /><img className="yours-logo-c" src={coin.logo} alt="" /></span>}
        <div className="yours-call-id"><b>{coin ? anchorOf(coin).name : "A round"} <span className="dimmer">in {sym}</span></b><span className="dimmer">bell {nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} New York</span></div>
        <span className={`yours-stage yours-stage-${stage.replace(" ", "-")}`}>{STAGE_TEXT[stage]}</span>
      </header>
      <dl className="yours-call-nums yours-call-nums-2">
        <div><dt>Put in</dt><dd>{money(put)}</dd>{rate !== null && <small>{coinText(put, l.decimals, sym)}</small>}</div>
        <div><dt>Fees so far</dt><dd className="up">{money(fees)}</dd><small>the rest is settled at the bell</small></div>
      </dl>
      <footer className="yours-call-foot">
        <span className="dimmer yours-clock-word">{lines.length} {lines.length === 1 ? "deposit" : "deposits"}</span>
        <Link className="btn btn-sm btn-ghost" to={`/m/${h.pubkey.toBase58()}`}>Open the round <span aria-hidden="true">→</span></Link>
      </footer>
    </article>
  );
}

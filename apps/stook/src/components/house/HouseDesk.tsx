// A coin's house on its page: the house's numbers (left), the deposit and
// withdraw box and your share (right). The house is one standing pool that
// funds every round of the coin; while its money is in a round, deposits and
// withdrawals wait for the bell and go through at the price the round leaves.
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { fmtCompact, parseAmount } from "../../lib/format";
import { ataOf, ensureAta } from "../../lib/chain";
import { isDevnet } from "../../lib/coins";
import { useBalance, useMint, useSend, useSeries } from "../../hooks/useChain";
import { useHouseRead } from "../../hooks/useHouse";
import { fmtUsd, fromUsd, toUsd, useUsdRates } from "../../lib/usd";
import { nyWhen } from "../../lib/time";

interface Props { series: PublicKey; mint: PublicKey; symbol: string }

/** "$18.4K"-style dollars for a tile: whole dollars past $1,000. */
function bigUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (a >= 1e4) return `$${(v / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return fmtUsd(v);
}

/** The house's numbers: its size, its average fee income per round, rounds played. */
export function HouseStats(p: Props) {
  const read = useHouseRead(p.series);
  const info = useMint(p.mint).data;
  const rate = useUsdRates().data?.[p.symbol] ?? null;
  const h = read.data?.h;
  const day = useRoundDay(p.series, h);
  if (!h || !info) return <div className="house-tiles house-tiles-wait" aria-hidden="true"><div className="card" /><div className="card" /><div className="card" /></div>;
  const dec = info.decimals;
  const coin = (v: bigint) => `${fmtCompact(v, dec)} ${p.symbol}`;
  // Dollars when the coin has a price; otherwise the coin, its ticker small.
  const main = (v: bigint) => (rate !== null ? bigUsd(toUsd(v, dec, rate)) : <>{fmtCompact(v, dec)}<small className="house-unit">{p.symbol}</small></>);
  const capital = stook.houseCapital(h);
  const busy = h.round !== null;
  return (
    <div className="house-tiles">
      <div className="card house-tile">
        <div className="label">House size</div>
        <div className="house-tile-v num">{main(capital)}</div>
        <div className="house-tile-s">{rate !== null && <span>{coin(capital)}</span>}
          {busy && <span title="Each round gets what the house's fee income can carry; the rest waits in the vault.">{fmtCompact(h.inRound, dec)} in {day ? `the ${day} round` : "a round"}</span>}
          {busy && h.assets > 0n && <span>{fmtCompact(h.assets, dec)} in the vault</span>}</div>
      </div>
      {h.feeEma > 0n && <div className="card house-tile">
        <div className="label">Fees per round, average</div>
        <div className="house-tile-v num up">+{main(h.feeEma)}</div>
        <div className="house-tile-s">{rate !== null && <span>{coin(h.feeEma)}</span>}<span>90% of trading fees</span></div>
      </div>}
      <div className="card house-tile">
        <div className="label">Rounds played</div>
        <div className="house-tile-v num">{h.epoch.toLocaleString("en-US")}</div>
        <div className="house-tile-s">{h.pendingDeposits > 0n ? <span>{coin(h.pendingDeposits)} joins after the round</span> : <span>one a day</span>}</div>
      </div>
    </div>
  );
}

/** The day of the round the house is in, "Oct 29", or null when idle or unknown. */
function useRoundDay(series: PublicKey, h: { round: PublicKey | null; lastIndex: number } | null | undefined): string | null {
  const sa = useSeries(series).data;
  if (!h?.round || !sa) return null;
  return nyWhen(stook.closeOf(sa, h.lastIndex), { month: "short", day: "numeric" });
}

const PCTS = [25, 50, 75, 100] as const;

/** The most a wallet holding `bal` can deposit: the transfer fee comes on top. */
function netFor(bal: bigint, fee: Parameters<typeof stook.grossFor>[1]): bigint {
  if (!fee || fee.bps === 0) return bal;
  let n = (bal * BigInt(10_000 - fee.bps)) / 10_000n;
  for (let i = 0; i < 64 && n > 0n && stook.grossFor(n, fee) > bal; i++) n -= 1n;
  return n;
}

/** Deposit and withdraw, then your share. */
export function HouseBox(p: Props) {
  const { publicKey } = useWallet();
  const modal = useWalletModal();
  const read = useHouseRead(p.series);
  const house = read.house!;
  const info = useMint(p.mint).data;
  const rate = useUsdRates().data?.[p.symbol] ?? null;
  const balance = useBalance(p.mint, info?.tokenProgram);
  const [tab, setTab] = useState<"in" | "out">("in");
  const [unitPicked, setUnit] = useState<"usd" | "coin" | null>(null);
  const unit = unitPicked ?? (rate !== null ? "usd" : "coin");
  const [text, setText] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const [outPct, setOutPct] = useState<number>(100);
  const deposit = useSend("Deposit");
  const withdraw = useSend("Withdrawal");
  const cancel = useSend("Deposit taken back");
  const claim = useSend("Claimed");

  const h = read.data?.h, s = read.data?.s ?? null;
  const day = useRoundDay(p.series, h);
  if (!h || !info) return <div className="card house-box house-box-wait" aria-busy={!read.isError}><div className="label">The house</div><p className="dimmer">{read.isError ? "Can't read the house. Trying again." : "Reading the house"}</p></div>;
  const inRound = `The house is in ${day ? `the ${day} round` : "a round"}.`;
  const dec = info.decimals;
  const coin = (v: bigint) => `${fmtCompact(v, dec)} ${p.symbol}`;
  const usd = (v: bigint) => (rate !== null ? fmtUsd(toUsd(v, dec, rate)) : null);
  const money = (v: bigint) => usd(v) ?? coin(v);
  const refs: stook.HouseRefs = { house, quoteMint: p.mint, tokenProgram: info.tokenProgram };
  const epoch = stook.epochFor(house, h, s);
  const busy = h.round !== null;
  const mine = s ? stook.stakeValue(h, s) : null;
  const share = mine && h.totalShares > 0n ? Number((mine.shares * 10_000n) / h.totalShares) / 100 : 0;
  const worth = mine ? mine.value : 0n;
  const free = mine ? mine.shares - mine.queuedShares : 0n;
  const locked = !!s && s.lockedUntil * 1000n > BigInt(Date.now()) && h.opensAfter !== stook.HOUSE_REJECTED;
  const ata = publicKey ? ataOf(p.mint, publicKey, info.tokenProgram) : null;
  const fee = info.report.transferFee;

  // Deposit: typed in dollars or in the coin; the house is credited `amount`.
  const typed = unit === "usd" && rate !== null ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, rate) : parseAmount(text, dec);
  const amount = typed && typed > 0n ? typed : null;
  const gross = amount ? stook.grossFor(amount, fee) : null;
  const short = balance.data !== undefined && gross !== null && balance.data < gross;
  const setFromPct = (pct: number) => {
    if (balance.data === undefined) return;
    const net = netFor((balance.data * BigInt(pct)) / 100n, fee);
    setPick(pct);
    if (unit === "usd" && rate !== null) setText((Math.floor(toUsd(net, dec, rate) * 100) / 100).toString());
    else setText((Number(net) / 10 ** dec).toString());
  };
  const swapUnit = () => {
    if (rate === null) return;
    const next = unit === "usd" ? "coin" : "usd";
    if (amount) setText(next === "usd" ? (Math.floor(toUsd(amount, dec, rate) * 100) / 100).toString() : (Number(amount) / 10 ** dec).toString());
    setUnit(next);
  };

  // Withdraw: a share of your free stake.
  const outShares = (free * BigInt(outPct)) / 100n;
  const outWorth = mine && mine.shares > 0n ? (worth * outShares) / mine.shares : 0n;
  const hasStake = !!mine && (mine.shares > 0n || mine.queuedDeposit > 0n || mine.claimable > 0n);
  const canClaim = !!mine && (mine.claimable > 0n || (!!epoch && mine.queuedShares > 0n));

  return (
    <>
      <div className="card house-box" id="house">
        <div className="seg2 house-tabs" role="tablist" aria-label="Deposit or withdraw">
          <button role="tab" aria-selected={tab === "in"} className={tab === "in" ? "on" : ""} onClick={() => setTab("in")}>Deposit</button>
          <button role="tab" aria-selected={tab === "out"} className={tab === "out" ? "on" : ""} onClick={() => setTab("out")}>Withdraw</button>
        </div>

        {tab === "in" ? <>
          <label className="house-amt">
            {unit === "usd" && <span className="house-amt-sign">$</span>}
            <input value={text} onChange={(e) => { setText(e.target.value); setPick(null); }} inputMode="decimal" placeholder="0" aria-label={unit === "usd" ? "Deposit in dollars" : `Deposit in ${p.symbol}`} />
            <button type="button" className="house-amt-alt" onClick={swapUnit} disabled={rate === null} title={rate !== null ? "Switch units" : undefined}>
              {unit === "usd" ? (amount ? coin(amount) : p.symbol) : amount && rate !== null ? usd(amount) : p.symbol}
              {rate !== null && <span aria-hidden="true"> ⇅</span>}
            </button>
          </label>
          <div className="chips chips-sm" role="group" aria-label="Part of your balance">
            {PCTS.map((pct) => <button key={pct} className={`chip ${pick === pct ? "on" : ""}`} disabled={!publicKey || balance.data === undefined} onClick={() => setFromPct(pct)}>{pct === 100 ? "Max" : `${pct}%`}</button>)}
          </div>
          <div className="house-row dimmer">
            <span>{publicKey ? "Balance" : "Connect a wallet to see your balance"}</span>
            {publicKey && <b className="num">{balance.data !== undefined ? coin(balance.data) : "…"}</b>}
          </div>
          {fee && gross !== null && amount !== null && gross > amount && <div className="house-row dimmer"><span>You send, with the {(fee.bps / 100).toFixed(0)}% transfer fee</span><b className="num">{coin(gross)}</b></div>}
          {busy && <p className="house-note now">{inRound} Your deposit joins when it settles. You can take it back until then.</p>}
          {short && <p className="house-note down">Not enough {p.symbol}.{isDevnet ? " Get test coins with Faucet in the header." : ""}</p>}
          {!publicKey ? <button className="btn btn-block" onClick={() => modal.setVisible(true)}>Connect a wallet</button>
            : <button className="btn btn-block" disabled={!amount || short || deposit.isPending}
                onClick={() => ata && amount && deposit.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseDepositIx(refs, publicKey, ata, amount, epoch, stook.maxGrossFor(amount, [fee]))], { onSuccess: () => { setText(""); setPick(null); } })}>
                {deposit.isPending ? "Sending…" : amount ? `Deposit ${money(amount)}` : "Enter an amount"}
              </button>}
          <p className="house-risk">{amount ? `The house can lose. Most you can lose: ${money(amount)}.` : "The house can lose. Deposit only what you can lose."}</p>
        </> : <>
          {!publicKey ? <>
            <p className="house-empty dimmer">Connect a wallet to see your stake.</p>
            <button className="btn btn-block" onClick={() => modal.setVisible(true)}>Connect a wallet</button>
          </> : free <= 0n ? <p className="house-empty dimmer">{mine && mine.queuedShares > 0n ? "All of your stake leaves after the round." : "Nothing to withdraw yet."}</p> : <>
            <div className="house-amt house-amt-read">
              <span className="house-amt-val num">{money(outWorth)}</span>
              <span className="house-amt-alt">{rate !== null ? coin(outWorth) : `${outPct}%`}</span>
            </div>
            <div className="chips chips-sm" role="group" aria-label="Part of your stake">
              {PCTS.map((pct) => <button key={pct} className={`chip ${outPct === pct ? "on" : ""}`} onClick={() => setOutPct(pct)}>{pct === 100 ? "All" : `${pct}%`}</button>)}
            </div>
            {locked && <p className="house-note" title="A listing's seed stays in the house a week.">Locked until {nyWhen(Number(s!.lockedUntil), { weekday: "short", month: "short", day: "numeric", hour: "numeric" })} NY.</p>}
            {busy && !locked && <p className="house-note now">{inRound} This leaves when it settles, at the price the round leaves.</p>}
            <button className="btn btn-block" disabled={locked || outShares <= 0n || withdraw.isPending}
              onClick={() => ata && withdraw.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseWithdrawIx(refs, publicKey, ata, outShares, epoch)])}>
              {withdraw.isPending ? "Sending…" : busy ? `Withdraw ${outPct === 100 ? "it all" : `${outPct}%`} after the round` : `Withdraw ${money(outWorth)}`}
            </button>
          </>}
        </>}
      </div>

      {publicKey && hasStake && mine && (
        <div className="card house-yours" aria-label="Your share">
          <div className="label">Your share</div>
          <div className="house-yours-v num">{money(worth)}</div>
          <div className="house-row dimmer">
            <span>{share > 0 && share < 0.1 ? "Under 0.1%" : `${share.toFixed(1)}%`} of the house</span>
            <span>{rate !== null ? coin(worth) : ""}{busy ? " at what went in" : ""}</span>
          </div>
          {(mine.queuedDeposit > 0n || mine.queuedShares > 0n || mine.claimable > 0n) && <div className="house-yours-list">
            {mine.queuedDeposit > 0n && <div className="house-row"><span>Joins after the round</span><b className="num">{coin(mine.queuedDeposit)}</b></div>}
            {mine.queuedShares > 0n && <div className="house-row"><span>Leaves after the round</span><b className="num">{((Number(mine.queuedShares) / Number(mine.shares || 1n)) * 100).toFixed(0)}% of your stake</b></div>}
            {mine.claimable > 0n && <div className="house-row"><span>Ready to claim</span><b className="num up">{coin(mine.claimable)}</b></div>}
          </div>}
          {(canClaim || (mine.queuedDeposit > 0n && busy && ata)) && <div className="house-yours-act">
            {canClaim && ata && <button className="btn btn-sm" disabled={claim.isPending} onClick={() => claim.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseClaimIx(refs, publicKey, ata, epoch)])}>
              {claim.isPending ? "Claiming…" : mine.claimable > 0n ? `Claim ${money(mine.claimable)}` : "Claim your withdrawal"}
            </button>}
            {mine.queuedDeposit > 0n && busy && ata && <button className="btn btn-sm btn-ghost" disabled={cancel.isPending} onClick={() => cancel.mutate([stook.houseCancelDepositIx(refs, publicKey, ata)])}>
              {cancel.isPending ? "Sending…" : "Take back the deposit"}
            </button>}
          </div>}
        </div>
      )}
    </>
  );
}

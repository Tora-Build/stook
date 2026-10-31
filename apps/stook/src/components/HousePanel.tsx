// A coin's house: one standing pool that funds every round of the coin, one
// after another. Deposit once and stay in from day to day; while the house's
// money is in a round, deposits and withdrawals wait for the bell and go
// through at the price the round leaves.
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { fmtCompact, parseAmount } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { Notice } from "./Notice";
import { nyWhen } from "../lib/time";
import { isDevnet } from "../lib/coins";
import { useHouseRead } from "../hooks/useHouse";

interface Props { series: PublicKey; mint: PublicKey; symbol: string; /** Inside another panel (the round's ticket): no frame of its own. */ bare?: boolean }

export function HousePanel(p: Props) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const house = stook.deriveHouse(p.series);
  const info = useMint(p.mint).data;
  // The same read (and query key) as the coin page's house box.
  const read = useHouseRead(p.series);
  const balance = useBalance(p.mint, info?.tokenProgram);
  const [text, setText] = useState("100");
  const deposit = useSend("Deposit");
  const withdraw = useSend("Withdrawal");
  const cancel = useSend("Deposit taken back");
  const claim = useSend("Claimed");

  const h = read.data?.h, s = read.data?.s ?? null;
  if (!h || !info) return null;
  const dec = info.decimals;
  const refs: stook.HouseRefs = { house, quoteMint: p.mint, tokenProgram: info.tokenProgram };
  const epoch = stook.epochFor(house, h, s);
  const coin = (v: bigint) => `${fmtCompact(v, dec)} ${p.symbol}`;
  const busy = h.round !== null;
  // In a round, part of the house may wait in the vault: the round is sized
  // to the fees the house earns (the program's commit_for).
  const capital = stook.houseCapital(h);
  const mine = s ? stook.stakeValue(h, s) : null;
  // While the house is in a round its price is not known until the bell, so
  // a stake is shown as its share, valued at what went in.
  const share = mine && h.totalShares > 0n ? Number((mine.shares * 10_000n) / h.totalShares) / 100 : 0;
  const worth = mine ? mine.value : 0n;
  const free = mine ? mine.shares - mine.queuedShares : 0n;
  const amount = parseAmount(text, dec);
  // On a coin with a transfer fee the house is credited the amount and the
  // wallet sends the fee on top.
  const fee = info.report.transferFee;
  const gross = amount ? stook.grossFor(amount, fee) : null;
  const short = balance.data !== undefined && gross !== null && balance.data < gross;
  const ata = publicKey ? ataOf(p.mint, publicKey, info.tokenProgram) : null;

  return (
    <section className={p.bare ? "" : "panel"}>
      <h3>The {p.symbol} house</h3>
      <p className="hint">It funds every {p.symbol} round and keeps 90% of the fees. Deposit once and stay in.</p>
      <div className="ticket-paper" role="group" aria-label="The house">
        <div className="tp-row"><span>The house holds</span><i /><b className="mono">{coin(capital)}</b></div>
        {busy && <div className="tp-row tp-small"><span>in today's round</span><i /><b className="mono">{coin(h.inRound)}</b></div>}
        {busy && h.assets > 0n && <div className="tp-row tp-small" title="Each round gets what the house's fee income can carry; the rest waits for a busier day."><span>waiting in the vault</span><i /><b className="mono">{coin(h.assets)}</b></div>}
        {h.pendingDeposits > 0n && <div className="tp-row tp-small"><span>joining at the bell</span><i /><b className="mono">{coin(h.pendingDeposits)}</b></div>}
        <div className="tp-row tp-small"><span>rounds rolled</span><i /><b className="mono">{h.epoch}</b></div>
      </div>

      {mine && (mine.shares > 0n || mine.queuedDeposit > 0n || mine.claimable > 0n) && (
        <div className="ticket-paper" role="group" aria-label="Your stake">
          <div className="tp-head"><span>Your stake</span><b className="mono">{share > 0 && share < 0.1 ? "under 0.1%" : `${share.toFixed(1)}%`} of the house</b></div>
          <div className="tp-row"><span>{busy ? "worth, at what went in" : "worth now"}</span><i /><b className="mono">{coin(worth)}</b></div>
          {s && s.lockedUntil * 1000n > BigInt(Date.now()) && h.opensAfter !== stook.HOUSE_REJECTED && <div className="tp-row tp-small" title="A listing's seed stays in the house a week."><span>locked until</span><i /><b className="mono">{nyWhen(Number(s.lockedUntil), { weekday: "short", month: "short", day: "numeric", hour: "numeric" })}</b></div>}
          {mine.queuedDeposit > 0n && <div className="tp-row tp-small"><span>deposit joining at the bell</span><i /><b className="mono">{coin(mine.queuedDeposit)}</b></div>}
          {mine.queuedShares > 0n && <div className="tp-row tp-small"><span>leaving at the bell</span><i /><b className="mono">{((Number(mine.queuedShares) / Number(mine.shares || 1n)) * 100).toFixed(0)}% of your stake</b></div>}
          {mine.queuedDeposit > 0n && busy && publicKey && ata && (
            <button disabled={cancel.isPending} onClick={() => cancel.mutate([stook.houseCancelDepositIx(refs, publicKey, ata)])}>Take back the waiting deposit</button>
          )}
          {(mine.claimable > 0n || (epoch && mine.queuedShares > 0n)) && publicKey && ata && (
            <button className="primary" disabled={claim.isPending} onClick={() => claim.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseClaimIx(refs, publicKey, ata, epoch)])}>
              {claim.isPending ? "Claiming…" : `Claim ${mine.claimable > 0n ? coin(mine.claimable) : "your withdrawal"}`}
            </button>
          )}
          {free > 0n && publicKey && ata && !(s && s.lockedUntil * 1000n > BigInt(Date.now()) && h.opensAfter !== stook.HOUSE_REJECTED) && (
            <button disabled={withdraw.isPending} onClick={() => withdraw.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseWithdrawIx(refs, publicKey, ata, free, epoch)])}>
              {withdraw.isPending ? "Sending…" : busy ? "Withdraw it all at the bell" : `Withdraw ${coin(worth)}`}
            </button>
          )}
        </div>
      )}

      <div className="field">
        <div className="amount-head"><span>Deposit</span></div>
        <div className="amount-input">
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={`Deposit in ${p.symbol}`} />
          <span className="amount-unit">{p.symbol}</span>
        </div>
        <span className="hint">{!publicKey ? "Connect a wallet to see your balance" : <>balance {balance.data !== undefined ? coin(balance.data) : "…"}</>}</span>
      </div>
      {fee && gross !== null && amount !== null && gross > amount && <span className="hint">You send {coin(gross)}: the coin's {(fee.bps / 100).toFixed(0)}% transfer fee comes on top, once.</span>}
      {busy && <span className="hint">The house is in today's round: your deposit joins at the bell. You can take it back until then.</span>}
      {short && <Notice tone="stop" title={`Not enough ${p.symbol}`}>{isDevnet ? <>Get <b>test coins</b> with Faucet in the header.</> : <>Your wallet holds less than this deposit.</>}</Notice>}
      <button className="primary" disabled={!!publicKey && (!amount || short || deposit.isPending)}
        onClick={() => !publicKey ? setVisible(true) : ata && amount && deposit.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseDepositIx(refs, publicKey, ata, amount, epoch, stook.maxGrossFor(amount, [fee]))])}>
        {!publicKey ? "Connect a wallet" : deposit.isPending ? "Sending…" : `Deposit ${amount ? coin(amount) : `0 ${p.symbol}`}`}
      </button>
    </section>
  );
}

// A coin's house: one standing pool that funds every round of the coin, one
// after another. Deposit once and stay in from day to day; while the house's
// money is in a round, deposits and withdrawals wait for the bell and go
// through at the price the round leaves.
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { fmtCompact, parseAmount } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { Notice } from "./Notice";

interface Props { series: PublicKey; mint: PublicKey; symbol: string }

export function HousePanel(p: Props) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const house = stook.deriveHouse(p.series);
  const info = useMint(p.mint).data;
  const read = useQuery({
    queryKey: ["house", house.toBase58(), publicKey?.toBase58()],
    queryFn: async () => {
      const [h, s] = await connection.getMultipleAccountsInfo([house, ...(publicKey ? [stook.deriveHouseStake(house, publicKey)] : [])]);
      return { h: h ? stook.decodeHouse(h.data) : null, s: s ? stook.decodeHouseStake(s.data) : null };
    },
    refetchInterval: 15_000,
  });
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
  const capital = busy ? h.inRound : h.assets;
  const mine = s ? stook.stakeValue(h, s) : null;
  // While the house is in a round its price is not known until the bell, so
  // a stake is shown as its share, valued at what went in.
  const share = mine && h.totalShares > 0n ? Number((mine.shares * 10_000n) / h.totalShares) / 100 : 0;
  const worth = mine ? (busy ? (capital * mine.shares) / (h.totalShares || 1n) : mine.value) : 0n;
  const free = mine ? mine.shares - mine.queuedShares : 0n;
  const amount = parseAmount(text, dec);
  const short = balance.data !== undefined && amount !== null && balance.data < amount;
  const ata = publicKey ? ataOf(p.mint, publicKey, info.tokenProgram) : null;

  return (
    <section className="panel">
      <h3>The {p.symbol} house</h3>
      <p className="hint">One pool that funds every {p.symbol} round, one after another. Deposit once and stay in; 90% of every fee goes to the house.</p>
      <div className="tp-row"><span>{busy ? "In today's round" : "Waiting for the next round"}</span><i /><b className="mono">{coin(capital)}</b></div>
      {h.pendingDeposits > 0n && <div className="tp-row tp-small"><span>joining at the bell</span><i /><b className="mono">{coin(h.pendingDeposits)}</b></div>}

      {mine && (mine.shares > 0n || mine.queuedDeposit > 0n || mine.claimable > 0n) && (
        <div className="ticket-paper" role="group" aria-label="Your stake">
          <div className="tp-head"><span>Your stake</span><b className="mono">{share > 0 && share < 0.1 ? "under 0.1%" : `${share.toFixed(1)}%`} of the house</b></div>
          <div className="tp-row"><span>{busy ? "worth, at what went in" : "worth now"}</span><i /><b className="mono">{coin(worth)}</b></div>
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
          {free > 0n && publicKey && ata && (
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
      {busy && <Notice tone="info" title="The house is in today's round">Your deposit waits for the bell and joins at the price the round leaves. You can take it back until then.</Notice>}
      {short && <Notice tone="stop" title={`Not enough ${p.symbol}`}>On devnet, get <b>test coins</b> in the header.</Notice>}
      <button className="primary" disabled={!publicKey || !amount || short || deposit.isPending}
        onClick={() => publicKey && ata && amount && deposit.mutate([ensureAta(p.mint, publicKey, info.tokenProgram), stook.houseDepositIx(refs, publicKey, ata, amount, epoch)])}>
        {!publicKey ? "Connect a wallet" : deposit.isPending ? "Sending…" : `Deposit ${amount ? coin(amount) : `0 ${p.symbol}`}`}
      </button>
    </section>
  );
}

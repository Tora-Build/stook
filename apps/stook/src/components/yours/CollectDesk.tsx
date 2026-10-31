// Ready to collect: a payout slip with one line per finished round (each
// opens to its calls and its own Collect), and beside it the total and the
// one button that collects every round.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Holding } from "../../lib/chain";
import { collectTxs } from "../../lib/collect";
import { anchorOf, coinByMint, type Coin } from "../../lib/coins";
import { useMint, useSend } from "../../hooks/useChain";
import { coinText, fmtUsd, toUsd } from "../../lib/usd";
import { fmtCompact } from "../../lib/format";
import { nyWhen } from "../../lib/time";
import { Fold } from "../Fold";
import { PixelCoins } from "./art";
import { value } from "./model";

export interface SlipItem { h: Holding; c: Coin | undefined; ready: bigint; usd: number | null }

export function CollectDesk({ slip, now, own, progress, onCollectAll }: {
  slip: SlipItem[]; now: number; own: boolean; progress: [number, number] | null; onCollectAll: () => void;
}) {
  const usd = slip.reduce((a, x) => a + (x.usd ?? 0), 0);
  const paying = slip.filter((x) => x.ready > 0n);
  const coins = [...new Set(paying.map((x) => x.c?.symbol ?? ""))];
  const one = coins.length <= 1 ? paying[0] : undefined;
  // Coins add up in dollars only when every paying coin has a price; else
  // the slip lists each coin, so it never reads "$0" with coins owed.
  const priced = paying.length > 0 && paying.every((x) => x.usd !== null) && usd > 0;
  const perCoin = [...paying.reduce((m, x) => { const k = x.c?.symbol ?? ""; const t = m.get(k); m.set(k, { dec: x.h.ladder.decimals, v: (t?.v ?? 0n) + x.ready }); return m; }, new Map<string, { dec: number; v: bigint }>())]
    .map(([k, x]) => `${fmtCompact(x.v, x.dec)} $${k}`).join(" + ");
  const total = one ? coinText(paying.reduce((a, x) => a + x.ready, 0n), one.h.ladder.decimals, `$${one.c?.symbol ?? ""}`) : priced ? `≈ ${fmtUsd(usd)}` : perCoin;
  const nothing = slip.length - paying.length;
  const [more, setMore] = useState(false);
  const SHOWN = 5;

  return (
    <div className="yours-collect">
      <div className="yours-slip" role="group" aria-label="Payout slip">
        <div className="yours-slip-head">
          <span className="kicker">STOOK STREET SECURITIES · PAYOUT SLIP</span>
          <b>{slip.length} finished {slip.length === 1 ? "round" : "rounds"}</b>
        </div>
        {slip.slice(0, SHOWN).map((x) => <SlipRound key={x.h.pubkey.toBase58()} x={x} now={now} own={own} />)}
        {slip.length > SHOWN && <>
          <Fold open={more}>{slip.slice(SHOWN).map((x) => <SlipRound key={x.h.pubkey.toBase58()} x={x} now={now} own={own} />)}</Fold>
          <button className="yours-slip-more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Fold it back" : `Unfold ${slip.length - SHOWN} more ${slip.length - SHOWN === 1 ? "round" : "rounds"}`}</button>
        </>}
        <div className="yours-slip-total">
          <span>Total to collect</span><i />
          <b>{paying.length ? total : "Nothing won"}</b>
        </div>
      </div>

      <aside className="card yours-take">
        <PixelCoins size={56} />
        <div className="label">Ready to collect</div>
        <div className={`yours-take-v ${paying.length ? "up" : "dimmer"} ${paying.length && !one && !priced ? "yours-take-v-list" : ""}`}>{paying.length ? total : "0"}</div>
        <div className="yours-take-sub">{one ? (usd > 0 ? `≈ ${fmtUsd(usd)} today` : "") : priced ? perCoin : ""}</div>
        {own
          ? <button className="btn btn-block" disabled={!!progress} onClick={onCollectAll}>{progress ? `Collecting ${progress[0]} of ${progress[1]}…` : paying.length ? (one || priced ? `Collect all ${total}` : `Collect all ${coins.length} coins`) : "Close them all"}</button>
          : <p className="yours-take-note">Only the account's own wallet can collect.</p>}
        <p className="yours-take-note">{nothing > 0
          ? `${nothing} ${nothing === 1 ? "round" : "rounds"} paid nothing. Closing ${nothing === 1 ? "it" : "them"} still hands back the small SOL deposit ${nothing === 1 ? "its" : "their"} accounts hold.`
          : "One signature per round. Each round's coins land in your wallet."}</p>
      </aside>
    </div>
  );
}

/** One round on the slip: name, day, amount; opens to each call and its own button. */
function SlipRound({ x, now, own }: { x: SlipItem; now: number; own: boolean }) {
  const [open, setOpen] = useState(false);
  const { publicKey } = useWallet();
  const { h, c, ready, usd } = x;
  const l = h.ladder, dec = l.decimals, sym = `$${c?.symbol ?? ""}`;
  const v = value(h, now, c ? anchorOf(c).dp : 2);
  const mint = useMint(l.quoteMint);
  const send = useSend(l.status === "void" ? "Refunded" : "Collected");
  const money = (u: bigint) => coinText(u, dec, sym);
  const cost = v.lines.reduce((a, y) => a + y.cost, 0n), net = v.ready - cost;
  const collectable = own && v.lines.length > 0;
  const collect = async () => {
    if (!publicKey || !mint.data) return;
    try { for (const tx of collectTxs(h, publicKey, mint.data.tokenProgram)) await send.mutateAsync(tx); } catch { /* the toast has said why */ }
  };
  return (
    <div className={`yours-slip-round ${open ? "on" : ""}`}>
      <button className="yours-slip-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="yours-slip-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        {c && <img src={c.logo} alt="" />}
        <span className="yours-slip-name">{c ? anchorOf(c).name : "Round"} in {sym}<em>{nyWhen(l.settlesAt, { weekday: "short", month: "short", day: "numeric" })}{l.status === "void" ? " · void, refund" : ""}</em></span>
        <i />
        <b>{ready === 0n ? <span className="yours-slip-nil">nothing won</span> : money(ready)}{ready > 0n && usd !== null && <small>≈ {fmtUsd(usd)}</small>}</b>
      </button>
      <Fold open={open}>
        <div className="yours-slip-body">
          {v.lines.map((y) => (
            <div key={y.key} className="yours-slip-sub">
              <span className={`yours-kind yours-kind-${y.kind}`}>{y.kind === "line" ? "Call" : "House"}</span>
              <span>{y.what}<em>{y.kind === "line" ? "paid" : "put in"} {money(y.cost)}</em></span>
              <i />
              <b className={y.value && y.value > 0n ? "up" : "dimmer"}>{y.value && y.value > 0n ? money(y.value) : "0"}</b>
            </div>
          ))}
          {cost > 0n && <div className="yours-slip-sub yours-slip-net"><span>Net on this round</span><i /><b className={net < 0n ? "down" : "up"}>{net >= 0n ? "+" : "−"}{money(net >= 0n ? net : -net)}</b></div>}
          <div className="yours-slip-act">
            {collectable
              ? <button className={v.ready > 0n ? "btn btn-sm" : "btn btn-sm btn-ghost"} disabled={!publicKey || !mint.data || send.isPending} onClick={() => void collect()}>
                  {send.isPending ? (v.ready > 0n ? "Collecting…" : "Closing…") : v.ready > 0n ? `Collect ${money(v.ready)}` : "Nothing won: close these out"}
                </button>
              : <span className="dimmer">Only the account's own wallet can collect.</span>}
            <Link to={`/m/${h.pubkey.toBase58()}`} className="yours-link">Open the round ›</Link>
          </div>
        </div>
      </Fold>
    </div>
  );
}

export const slipOf = (finished: Holding[], now: number, rates: Record<string, number>): SlipItem[] => finished.map((h) => {
  const c = coinByMint(h.ladder.quoteMint), v = value(h, now, c ? anchorOf(c).dp : 2), rate = c ? rates[c.symbol] ?? null : null;
  return { h, c, ready: v.ready, usd: rate !== null ? toUsd(v.ready, h.ladder.decimals, rate) : null };
});

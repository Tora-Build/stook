// The self-serve listing, as four steps: the coin, what it follows, the
// seed, and the receipt to sign. Then the listed state, with a clock to the
// first round.
import { Link } from "react-router-dom";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { stook } from "@sooth/sdk-solana";
import { LISTABLE } from "../../lib/listed";
import { fmtCompact } from "../../lib/format";
import { nyWhen } from "../../lib/time";
import { useNow } from "../../hooks/useNow";
import { Notice } from "../Notice";
import { clock } from "../home/Hero";
import { Tick } from "./Art";
import { groupText, unitsToText } from "./data";
import { RENT_SOL, type Listing } from "./useListing";

const SHARES = [50n, 100n, 250n, 500n]; // of 10,000: 0.5%, 1%, 2.5%, 5%

export function Step({ n, title, done, children, sub }: { n: number; title: string; done: boolean; sub?: string; children: React.ReactNode }) {
  return (
    <li className={`card list-step ${done ? "done" : ""}`}>
      <div className="list-step-head">
        <span className="list-step-n pix">{String(n).padStart(2, "0")}</span>
        <div><h3>{title}</h3>{sub && <span className="label">{sub}</span>}</div>
        <span className="list-step-tick"><Tick on={done} size={24} /></span>
      </div>
      <div className="list-step-body">{children}</div>
    </li>
  );
}

/** Step 1, shared with the apply form: the mint, and what the chain says about it. */
export function CoinStep({ L, onApply, apply }: { L: Listing; onApply?: () => void; apply?: boolean }) {
  const { mintText, setMintText, mint, look, sym, logo, supply, dec, fee, problem } = L;
  return (
    <>
      <label className="list-field">
        <span className="label">The coin's mint address</span>
        <input className="input list-mint" value={mintText} onChange={(e) => setMintText(e.target.value)} placeholder="Paste the mint" aria-label="Mint address" spellCheck={false} autoComplete="off" />
      </label>
      {mintText.trim() && !mint && <p className="list-hint list-hint-bad">That is not a Solana address.</p>}
      {L.coinLoading && (
        <div className="list-coin list-coin-skel" aria-busy="true"><i className="list-skel list-skel-dot" /><div><i className="list-skel list-skel-line" /><i className="list-skel list-skel-line short" /></div></div>
      )}
      {L.coinError && <p className="list-hint list-hint-bad">Could not read that coin. <button className="list-link" onClick={() => void look.refetch()}>Try again</button></p>}
      {mint && look.data && (
        <div className="list-coin">
          {logo && <img src={logo} alt="" />}
          <div className="list-coin-id"><b>{look.data.meta?.name || "No name"}</b><span className="label">${sym}</span></div>
          <dl className="list-coin-facts">
            <div><dt>supply</dt><dd className="num">{fmtCompact(supply, dec)}</dd></div>
            <div><dt>transfer fee</dt><dd className="num">{fee ? `${(fee.bps / 100).toFixed(1)}%` : "none"}</dd></div>
          </dl>
        </div>
      )}
      {problem && apply && problem.kind === "trusted" ? (
        <Notice tone="info" title="We review this one by hand">
          Its issuer keeps powers over holders: {L.info?.report.reasons.join("; ")}. That is fine for an application. We check it before its table opens.
        </Notice>
      ) : problem && (
        <Notice tone="stop" title="Not this coin">
          {problem.text}
          {problem.kind === "trusted" && onApply && <> <button className="list-link" onClick={onApply}>Apply to list it instead</button></>}
        </Notice>
      )}
    </>
  );
}

/** Step 2: the anchors open for listing here. */
export function AnchorStep({ L }: { L: Listing }) {
  const { anchors, feed, setFeed } = L;
  if (anchors.isLoading) return <div className="list-anchors" aria-busy="true">{[0, 1, 2].map((i) => <span key={i} className="list-anchor list-skel-chip"><i className="list-skel list-skel-dot" /><i className="list-skel list-skel-line" /></span>)}</div>;
  if (anchors.isError) return <p className="list-hint list-hint-bad">Could not read the open assets. <button className="list-link" onClick={() => void anchors.refetch()}>Try again</button></p>;
  if (!anchors.data?.length) return <p className="list-hint">The street has no assets open for listing on this network yet.</p>;
  return (
    <div className="list-anchors" role="group" aria-label="It follows">
      {anchors.data.map((a) => {
        const x = LISTABLE[a.hex]!;
        return (
          <button key={a.hex} className={`list-anchor ${feed === a.hex ? "on" : ""}`} aria-pressed={feed === a.hex} onClick={() => setFeed(a.hex)}>
            <img src={x.logo} alt="" />
            <span><b>{x.name}</b><small>{x.symbol} · {x.hours === "24/7" ? "every day" : "weekdays"}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function SeedStep({ L }: { L: Listing }) {
  const { supply, dec, sym, text, setText, min, max, seed, amt, publicKey, balance, seedProblem } = L;
  const span = max - min;
  const at = seed !== null && span > 0n ? Math.max(0, Math.min(1, Number(((seed - min) * 1000n) / span) / 1000)) : null;
  return (
    <>
      {supply > 0n && (
        <div className="seg2 list-shares" role="group" aria-label="Share of supply">
          {SHARES.map((b) => { const one = 10n ** BigInt(dec), raw = (supply * b) / 10_000n, whole = (raw / one) * one, v = whole >= min && whole > 0n ? whole : raw < min ? min : raw; const t = groupText(unitsToText(v, dec)); return <button key={String(b)} className={text === t ? "on" : ""} onClick={() => setText(t)}>{Number(b) / 100}%</button>; })}
        </div>
      )}
      <div className="list-amount">
        <input className="input input-big" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setText(groupText(text))} inputMode="decimal" aria-label="Seed amount" placeholder={supply > 0n ? groupText(unitsToText(min, dec)) : "0"} disabled={!L.coinOk} />
        <span className="list-unit">{sym || "coin"}</span>
      </div>
      <div className="list-range" aria-hidden="true">
        <span className="list-range-bar"><i style={{ left: at === null ? "0%" : `${at * 100}%`, opacity: at === null ? 0 : 1 }} /></span>
        <span className="list-range-k"><span>0.5%{supply > 0n ? ` · ${amt(min)}` : ""}</span><span>5%{supply > 0n ? ` · ${amt(max)}` : ""}</span></span>
      </div>
      <p className="list-hint">{L.coinOk ? "Pick a share or type an amount." : "Choose the coin first."}{publicKey && balance.data !== undefined ? <> You hold <b>{amt(balance.data)}</b>.</> : null}</p>
      {seedProblem && <Notice tone="warn" title="Check the seed">{seedProblem}</Notice>}
    </>
  );
}

function Receipt({ L }: { L: Listing }) {
  const { seed, gross, amt, feeSol, config, anchor, sym } = L;
  const now = Math.floor(Date.now() / 1000);
  const when = (s: bigint) => nyWhen(now + Number(s), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="list-stub" role="group" aria-label="The listing">
      <div className="list-stub-top">
        <span className="kicker">LOCKED IN THE HOUSE</span>
        <b className="list-stub-amt num">{seed ? amt(seed) : <span className="dimmer">0 {sym || ""}</span>}</b>
        <span className="dimmer">{anchor ? `${sym ? `$${sym}` : "Your coin"} on ${anchor.name}` : "Pick what it follows"}</span>
      </div>
      <dl className="list-stub-rows">
        {gross !== null && seed !== null && gross > seed && <div><dt>You send, with the transfer fee</dt><dd className="num">{amt(gross)}</dd></div>}
        <div><dt>Locked until</dt><dd>{when(stook.LIST_LOCK_SECS)} NY</dd></div>
        <div><dt>First round</dt><dd>{when(stook.LIST_DELAY_SECS)} NY</dd></div>
        <div><dt>Listing fee</dt><dd className="num">{feeSol ?? (config.isLoading ? <i className="list-skel list-skel-line short" /> : "unknown")}</dd></div>
        <div><dt>Account rent, one time</dt><dd className="num">about {RENT_SOL} SOL</dd></div>
      </dl>
    </div>
  );
}

export function ListFlow({ L, onApply }: { L: Listing; onApply: () => void }) {
  const modal = useWalletModal();
  const { publicKey, send, ready, sym, anchor } = L;
  // The send hook already shows the error as a toast; this only keeps the
  // rejected promise from going unhandled.
  const list = async () => { try { await L.list(); } catch { /* shown by the toast */ } };
  if (L.listed) return <Listed L={L} />;
  return (
    <ol className="list-steps">
      <Step n={1} title="Choose the coin" done={L.coinOk}><CoinStep L={L} onApply={onApply} /></Step>
      <Step n={2} title="Choose what it follows" sub="Rounds settle on this price at 4 PM New York, from Pyth." done={L.coinOk && !!anchor}><AnchorStep L={L} /></Step>
      <Step n={3} title="Seed the house" sub="0.5% to 5% of the supply" done={L.seedOk}><SeedStep L={L} /></Step>
      <Step n={4} title="Review and sign" done={false}>
        <Receipt L={L} />
        {!publicKey
          ? <button className="btn btn-block" onClick={() => modal.setVisible(true)}>Connect a wallet to list</button>
          : <button className="btn btn-block" disabled={!ready || send.isPending} onClick={() => void list()}>{send.isPending ? "Listing" : `List ${sym ? `$${sym}` : "the coin"}${anchor ? ` on ${anchor.name}` : ""}`} {!send.isPending && <span aria-hidden="true">→</span>}</button>}
        <p className="list-hint list-sign-note">{publicKey && !ready && !send.isPending ? "Finish the steps above to sign." : "The house can lose. Lock only what you can lose."}</p>
      </Step>
    </ol>
  );
}

function Listed({ L }: { L: Listing }) {
  const now = useNow();
  const l = L.listed!;
  const at = Number(l.at);
  return (
    <div className="card list-done">
      <div className="list-done-stub">
        <span className="kicker taxi">LISTED</span>
        <b className="list-done-sym">${l.symbol}</b>
        <span className="dim">on {l.anchor}</span>
      </div>
      <div className="list-done-copy">
        <h3>${l.symbol} is listed</h3>
        <p className="dim">Its first round opens {nyWhen(at, { weekday: "short", hour: "numeric", minute: "2-digit" })} New York. The street can turn it down before then; if it does, the seed comes back at once.</p>
        <div className="list-done-clock"><span className="count">{clock(at - now)}</span><span className="label">until the first round</span></div>
        <div className="list-done-ctas">
          <Link className="btn btn-sm" to={l.path}>See its page <span aria-hidden="true">→</span></Link>
          <button className="btn btn-sm btn-ghost" onClick={() => { L.setListed(null); L.setMintText(""); L.setText(""); }}>List another coin</button>
        </div>
      </div>
    </div>
  );
}

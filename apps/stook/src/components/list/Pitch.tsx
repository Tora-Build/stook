// The list page's explainers: what holders get, what a lister needs (ticked
// off live as the form below fills in), the coins already listed, and the
// short answers.
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import { nyWhen } from "../../lib/time";
import { coinPath } from "../../lib/coins";
import type { ListedCoin } from "../../lib/listed";
import { RENT_SOL } from "./useListing";
import { DailyArt, LotArt, TableArt, TalkArt, Tick, VaultArt } from "./Art";

export function Gets({ sym }: { sym: string }) {
  const coin = sym ? `$${sym}` : "your coin";
  const items = [
    { art: <DailyArt size={150} />, tone: "now", k: "EVERY DAY", h: `A daily game in ${coin}`, p: `Holders call where a price closes at 4 PM New York. They play and win in ${coin}.` },
    { art: <VaultArt size={150} />, tone: "up", k: "THE HOUSE", h: "A house that earns", p: "Your seed is the house. It takes the other side of every call and keeps 90% of the fees." },
    { art: <TableArt size={140} />, tone: "taxi", k: "THE FLOOR", h: "A table on the floor", p: "Its own table on the trading floor, its own page, its own calendar of rounds." },
  ];
  return (
    <section className="list-sec" aria-labelledby="list-gets-h">
      <div className="list-sec-head"><span className="kicker taxi">WHAT HOLDERS GET</span><h2 id="list-gets-h">Give holders a reason to hold</h2></div>
      <ol className="list-gets">
        {items.map((it, i) => (
          <li key={it.k} className={`card list-get list-get-${it.tone}`}>
            <div className="list-get-art">{it.art}<span className="list-get-n pix">0{i + 1}</span></div>
            <span className="kicker">{it.k}</span>
            <h3>{it.h}</h3>
            <p>{it.p}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What the checklist ticks: in the application the last box is a way to reach the team, not SOL. */
export interface NeedState { token: boolean; anchor: boolean; seed: boolean; last: boolean }

export function Needs({ done, apply, feeSol, totalSol, anchors }: { done: NeedState; apply: boolean; feeSol: string | null; totalSol: string | null; anchors: { logo: string; symbol: string }[] }) {
  const lockDays = Number(stook.LIST_LOCK_SECS / 86_400n);
  const rent = `${RENT_SOL} SOL of one-time rent for the coin's accounts`;
  const rows = [
    { on: done.token, h: "A Solana token", p: "SPL or Token-2022. New accounts must not open frozen, and no transfer hook." + (apply ? " A coin whose issuer keeps powers is fine here: we review it by hand." : "") },
    { on: done.anchor, h: "An asset to follow, priced on chain", p: "Rounds follow an asset such as SOL or gold. It needs a Pyth feed or a Raydium concentrated pool.", extra: anchors.length ? <span className="list-need-logos">{anchors.map((a) => <img key={a.symbol} src={a.logo} alt={a.symbol} title={a.symbol} />)}<span className="dimmer">open here now</span></span> : null },
    { on: done.seed, h: "A house seed", p: apply ? `Your coin, worth $200 or more, as the house's first money. $1,000 or more lets callers bet bigger.` : `$200 or more of your coin, locked ${lockDays} days. $1,000 or more lets callers bet bigger.` },
    apply
      ? { on: done.last, h: "A way to reach you", p: `A Telegram or X handle. Applying is free and signs nothing. When we set up the table, the listing costs ${totalSol ? `about ${totalSol}: ${rent}, plus the ${feeSol} fee` : `${rent}, plus the listing fee`}.` }
      : { on: done.last, h: totalSol ? `About ${totalSol} in your wallet` : `About ${RENT_SOL} SOL plus the fee`, p: feeSol ? `The ${feeSol} listing fee, plus ${rent}.` : `${rent}, plus the listing fee.` },
  ];
  const count = rows.filter((r) => r.on).length;
  return (
    <section className="list-sec list-needs" id="list-needs" aria-labelledby="list-needs-h">
      <div className="list-needs-side">
        <div>
          <span className="kicker taxi">WHAT YOU NEED</span>
          <h2 id="list-needs-h">{apply ? "Four things, then apply" : "Four things, then sign"}</h2>
          <p className="dim">{apply ? "The boxes tick themselves as you fill in the application below." : "The boxes tick themselves as you fill in the form below."}</p>
        </div>
        <div className="list-ready" role="status" aria-label={`${count} of 4 ready`}>
          <span className="list-ready-k">READY</span>
          <b className="pix">{count}/4</b>
          <span className="list-ready-bars" aria-hidden="true">{rows.map((r) => <i key={r.h} className={r.on ? "on" : ""} />)}</span>
        </div>
      </div>
      <div className="card list-needs-card">
        <ul className="list-checks">
          {rows.map((r, i) => (
            <li key={r.h} className={r.on ? "on" : ""}>
              <span className="list-check-top"><span className="list-check-n pix">0{i + 1}</span><Tick on={r.on} size={28} /></span>
              <div><b>{r.h}</b><span>{r.p}</span>{r.extra}</div>
            </li>
          ))}
        </ul>
        <p className="list-risk"><span className="list-risk-sign pix" aria-hidden="true">!</span><span><b>Risks.</b> The house can lose: it pays the callers who land close. Anyone can list any coin, so traders must check the mint.</span></p>
      </div>
    </section>
  );
}

const STATE = { pending: "Opens", live: "Live", rejected: "Turned down", curated: "On the street" } as const;

export function Recent({ coins, ready }: { coins: ListedCoin[]; ready: boolean }) {
  return (
    <section className="list-sec" aria-labelledby="list-recent-h">
      <div className="list-sec-head list-sec-row"><div><span className="kicker taxi">ALREADY LISTED</span><h2 id="list-recent-h">On the street now</h2></div>{coins.length > 0 && <span className="label">{coins.length} listed by their communities</span>}</div>
      {!ready ? (
        <div className="list-recent">{[0, 1, 2].map((i) => <div key={i} className="card list-chip list-skel-chip"><i className="list-skel list-skel-dot" /><i className="list-skel list-skel-line" /></div>)}</div>
      ) : !coins.length ? (
        <div className="card list-empty">
          <LotArt size={220} />
          <div><h3>No coins listed yet</h3><p className="dim">This lot is empty. The first coin listed gets the first new table on the floor.</p></div>
        </div>
      ) : (
        <div className="list-recent">
          {coins.map((c) => (
            <Link key={c.mint} to={coinPath(c)} className={`card list-chip list-chip-${c.listing.state}`} title={c.mint}>
              <img src={c.logo} alt="" />
              <span className="list-chip-id"><b>${c.symbol}</b><span className="label">on {c.anchor.name}</span></span>
              <span className={`tag2 ${c.listing.state === "live" ? "live" : ""}`}>
                {STATE[c.listing.state]}{c.listing.state === "pending" ? ` ${nyWhen(Number(c.listing.opensAfter), { weekday: "short", hour: "numeric" })}` : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function Faq({ feeSol, totalSol, apply }: { feeSol: string | null; totalSol: string | null; apply: boolean }) {
  const lockDays = Number(stook.LIST_LOCK_SECS / 86_400n);
  const qa: [string, string][] = [
    ["What does it cost?", `${totalSol ? `About ${totalSol} all told: the ${feeSol} listing fee and ${RENT_SOL} SOL of rent.` : `${RENT_SOL} SOL of rent plus the listing fee.`} Then the seed you lock, which you can take back later.${apply ? " Applying is free." : ""}`],
    ["How long until rounds start?", apply ? "A day after the listing goes on chain, once we approve it." : "A day after you list. The clock starts when you sign."],
    ["Can I take the seed back?", `Yes, after ${lockDays} days, at any bell. It may have grown or shrunk by then.`],
    ["Who sets the price source?", "The street. Rounds settle on a Pyth feed or a Raydium pool it approves."],
    ["What if it is rejected?", "The street can turn a listing down in its first day. The seed comes back at once."],
  ];
  return (
    <section className="list-sec list-faq-wrap" aria-labelledby="list-faq-h">
      <div className="list-faq-side">
        <span className="kicker taxi">SHORT ANSWERS</span><h2 id="list-faq-h">Questions</h2>
        <div className="card list-talk">
          <TalkArt />
          <div><b>Still not sure?</b><p className="dim">Ask us. A person reads every message.</p>
            <span className="list-talk-ctas"><a className="btn btn-sm" href="https://t.me/StookStreet" target="_blank" rel="noreferrer">Telegram</a><a className="btn btn-sm btn-ghost" href="https://x.com/StookStreet" target="_blank" rel="noreferrer">X</a></span></div>
        </div>
      </div>
      <div className="list-faq">
        {qa.map(([q, a], i) => (
          <details key={q} className="card list-q" open={i === 0}>
            <summary><span>{q}</span><i aria-hidden="true" className="pix">+</i></summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

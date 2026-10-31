// The desk's header: the street at night with one tower whose floors light
// up with the player's open calls, and under it the four numbers that matter.
import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { City, type CityLayout } from "../City";
import { short } from "../../lib/format";
import { coinText, fmtUsd } from "../../lib/usd";
import { clock } from "../home/Hero";
import { coinOfSym, potUsd, type Pot } from "./model";

const FLOORS = 12;

export interface HeroNums {
  calls: number;
  ready: Pot; readyRounds: number;
  worth: Pot; paid: Pot; held: number;
  house: Pot; stakes: number;
  net: { pot: Pot; rounds: number; waiting: number } | null;
  /** The next bell among the open calls, in unix seconds. */
  nextBell: number | null;
}

export function YoursHero({ account, own, nums, loading, now, rates, progress, onCollectAll, onTab }: {
  account: PublicKey | null; own: boolean; nums: HeroNums | null; loading: boolean; now: number; rates: Record<string, number>;
  progress: [number, number] | null; onCollectAll: () => void; onTab: (t: "calls" | "collect" | "house" | "history") => void;
}) {
  const [lay, setLay] = useState<CityLayout | null>(null);
  const lit = nums ? Math.min(FLOORS, nums.calls) : 0;
  const band: [number, number] | null = lit > 0 ? [FLOORS - lit, FLOORS - 1] : null;
  const readyUsd = nums ? potUsd(nums.ready, rates) : null;
  // Short only when there is nothing to show (no wallet, an empty desk); while
  // the chain reads, the tall hero holds skeleton tiles so nothing jumps.
  const slim = !nums && !loading;
  // The tag beside the lit floors says what the title does not: when the next
  // bell rings.
  const bell = nums?.nextBell && nums.nextBell > now ? nums.nextBell - now : null;
  return (
    <header className={`yours-hero ${slim ? "yours-hero-short" : ""}`}>
      <City className="yours-hero-city" fade="both" px={4} place={{ exchange: 0.9, bull: 0.56, cart: 0.97, sign: 0.47 }}
        tower={slim ? { x: 0.64, w: 128, h: 220, floors: 8, band: null, sign: "YOURS" } : { x: 0.64, w: 150, h: 330, floors: FLOORS, band, sign: "YOURS" }} onLayout={setLay}>
        {lay?.tower && nums && nums.calls > 0 && band && bell !== null && (
          <div className="yours-tower" aria-hidden="true">
            <span className="yours-tower-tag" style={{ left: lay.tower.left + lay.tower.width + 24, top: lay.tower.floorTop(band[0]) }}>
              Next bell <span className="count">{clock(bell)}</span>
            </span>
          </div>
        )}
      </City>
      <div className="wrap yours-hero-in">
        <span className="kicker taxi">YOUR DESK</span>
        <h1>{nums && readyUsd !== null && readyUsd > 0 ? <>{own ? "You have" : "This desk has"} <em>{fmtUsd(readyUsd)}</em> to collect</> : nums && nums.calls > 0 ? <>{nums.calls} {nums.calls === 1 ? "call" : "calls"} at work</> : "Your desk"}</h1>
        <div className="yours-acct">
          <span className={`yours-dot ${account ? "on" : ""}`} aria-hidden="true" />
          {account ? <span>{short(account)}</span> : <span>No wallet connected</span>}
          {account && !own && <span className="yours-ro">read only</span>}
        </div>
      </div>

      {!nums && loading && (
        <div className="wrap yours-tiles" aria-busy="true" aria-label="Reading the books">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card yours-tile yours-tile-skel"><i /><i /><i /></div>)}
        </div>
      )}
      {nums && (
        <div className="wrap yours-tiles">
          <div className={`card yours-tile yours-tile-ready ${nums.ready.size ? "on" : ""}`}>
            <div className="label">Ready to collect</div>
            <Money pot={nums.ready} rates={rates} empty="$0" />
            <div className="yours-tile-s">{nums.readyRounds ? `from ${nums.readyRounds} finished ${nums.readyRounds === 1 ? "round" : "rounds"}` : "Finished rounds land here"}</div>
            {nums.readyRounds > 0 && (own
              ? <button className="btn btn-sm yours-tile-btn" disabled={!!progress} onClick={onCollectAll}>{progress ? `Collecting ${progress[0]} of ${progress[1]}…` : nums.ready.size ? "Collect all" : "Close them all"}</button>
              : <button className="btn btn-sm btn-ghost yours-tile-btn" onClick={() => onTab("collect")}>See the slip</button>)}
          </div>
          <button className="card yours-tile yours-tile-link" onClick={() => onTab("calls")}>
            <div className="label">Open calls</div>
            <div className="yours-tile-v">{nums.calls}</div>
            <div className="yours-tile-s">{nums.calls === 0 ? "None running" : <>{nums.worth.size ? <>worth <b><MoneyText pot={nums.worth} rates={rates} /></b> now</> : "held to the bell"}{nums.paid.size ? <> · paid <MoneyText pot={nums.paid} rates={rates} /></> : null}</>}</div>
          </button>
          <button className="card yours-tile yours-tile-link" onClick={() => onTab("house")}>
            <div className="label">In the house</div>
            <Money pot={nums.house} rates={rates} empty="$0" />
            <div className="yours-tile-s">{nums.stakes ? `${nums.stakes} ${nums.stakes === 1 ? "stake" : "stakes"} earning fees` : "Back the house to earn fees"}</div>
          </button>
          {nums.net && nums.net.rounds > 0 ? (
            <button className="card yours-tile yours-tile-link" onClick={() => onTab("history")}>
              <div className="label">Net, finished rounds</div>
              <Money pot={nums.net.pot} rates={rates} empty="$0" signed />
              <div className="yours-tile-s">over {nums.net.rounds} {nums.net.rounds === 1 ? "round" : "rounds"}{nums.net.waiting ? ", with what waits to collect" : ""}</div>
            </button>
          ) : (
            <button className="card yours-tile yours-tile-link" onClick={() => onTab("history")}>
              <div className="label">History</div>
              <div className="yours-tile-v dimmer">{nums.net ? "0" : "–"}</div>
              <div className="yours-tile-s">{nums.net ? "No finished rounds yet" : "Reading the ledger"}</div>
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/** A pot as one big figure: dollars when any coin has a price, else the one
 *  coin, with each coin as a chip beneath when there are several. */
function Money({ pot, rates, empty, signed }: { pot: Pot; rates: Record<string, number>; empty: string; signed?: boolean }) {
  const usd = potUsd(pot, rates);
  const rows = [...pot.entries()];
  const tone = signed ? (usd !== null ? (usd > 0 ? "up" : usd < 0 ? "down" : "") : rows[0] ? (rows[0][1].v > 0n ? "up" : "down") : "") : "";
  if (!rows.length) return <div className="yours-tile-v dimmer">{empty}</div>;
  return <>
    <div className={`yours-tile-v ${tone}`}>{usd !== null ? `${signed && usd > 0 ? "+" : ""}${fmtUsd(usd)}` : <MoneyText pot={pot} rates={rates} signed={signed} />}</div>
    {rows.length > 1 && <div className="yours-chips">{rows.map(([s, x]) => { const c = coinOfSym(s); return <span key={s} className={`yours-chip ${signed ? (x.v > 0n ? "up" : "down") : ""}`} title={`$${s}`}>{c && <img src={c.logo} alt={`$${s}`} />}{signed && x.v > 0n ? "+" : ""}{coinText(x.v, x.dec, "").trim()}</span>; })}</div>}
  </>;
}

function MoneyText({ pot, rates, signed }: { pot: Pot; rates: Record<string, number>; signed?: boolean }) {
  const usd = potUsd(pot, rates);
  if (usd !== null) return <>{signed && usd > 0 ? "+" : ""}{fmtUsd(usd)}</>;
  const rows = [...pot.entries()];
  return <>{rows.map(([s, x]) => `${signed && x.v > 0n ? "+" : ""}${coinText(x.v, x.dec, `$${s}`)}`).join(" + ")}</>;
}

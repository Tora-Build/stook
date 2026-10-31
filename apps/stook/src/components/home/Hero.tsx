// The home page's header picture: the night city with one lit tower, and the
// question the featured round asks. Every number on it is read, not drawn:
// the anchor's price, its move, the clock to the lock or the bell, and the
// round's own floors as tags on the tower.
import { useState } from "react";
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import { City, type CityLayout } from "../City";
import { WatchButton } from "../Watch";
import { coinPath } from "../../lib/coins";
import { nyAt, nyDate, nyWhen } from "../../lib/time";
import { fmtAnchor, fmtChange, phaseOf, useFeedQuote, type StreetRound } from "./useStreet";

const FLOORS = 18, MID = 9, BAND: [number, number] = [7, 11];

/** H:MM:SS, or D d H h past a day. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** The next 4 PM New York. */
export function nextBell(now: number): number {
  const [y, mo, d] = nyDate(now).split("-").map(Number) as [number, number, number];
  const today = nyAt(y, mo - 1, d, 16);
  return now < today ? today : nyAt(y, mo - 1, d + 1, 16);
}

export function Hero({ round, now }: { round: StreetRound | undefined; now: number }) {
  const [lay, setLay] = useState<CityLayout | null>(null);
  const q = useFeedQuote(round);
  const phase = phaseOf(round, now);
  const l = round?.round?.ladder;
  const a = round?.anchor;
  const bellAt = l ? Number(l.settlesAt) : round?.closesAt ?? nextBell(now);
  const bellHour = nyWhen(bellAt, { hour: "numeric", minute: "2-digit" }).replace(":00", "");

  // The clock counts to the next thing that happens to this round.
  const [until, what] = phase === "live" ? [Number(l!.locksAt), "left to call"]
    : phase === "opening" ? [Number(l!.opensAt), "until it opens"]
    : [bellAt, "to the bell"];
  const roundTo = round?.round ? `/m/${round.round.pubkey.toBase58()}` : round ? coinPath(round.coin) : "/how";
  const cta = phase === "live" ? "Make your call" : phase === "locked" ? "Watch the bell" : phase === "opening" ? "See the round" : phase === "settled" || phase === "void" ? "See where it landed" : "See the coin";

  // The round's own floors, beside the lit tower: one floor is one band of
  // the round, the middle one holds the price now. Only while calls are open.
  const tags: { y: number; text: string; kind: "now" | "edge" }[] = [];
  if (phase === "live" && lay?.tower && l && l.p0 > 0n && q && a) {
    const sc = 10 ** l.p0Expo, raw = q.price / sc;
    let k = 32;
    try { k = stook.binFor(BigInt(Math.round(raw)), l.p0, l.stepBps); } catch { /* keep the middle */ }
    const at = (bin: number, edge: "lo" | "hi") => stook.binBounds(bin, l.p0, l.stepBps)[edge === "lo" ? 0 : 1] * sc;
    const fy = (f: number) => lay.tower!.floorTop(f);
    const hiBin = k + (MID - BAND[0]), loBin = k - (BAND[1] - MID);
    if (hiBin < 63) tags.push({ y: fy(BAND[0]), text: fmtAnchor(at(hiBin, "hi"), a.dp), kind: "edge" });
    if (loBin > 0) tags.push({ y: fy(BAND[1] + 1), text: fmtAnchor(at(loBin, "lo"), a.dp), kind: "edge" });
    tags.push({ y: fy(MID) + lay.tower.floorH / 2, text: `NOW ${fmtAnchor(q.price, a.dp)}`, kind: "now" });
  }

  return (
    <section className="home-hero">
      <City className="home-city" fade="left" px={4} place={{ exchange: 0.83, bull: 0.53, cart: 0.95, sign: 0.47 }}
        tower={{ x: 0.62, w: 150, h: 540, floors: FLOORS, band: phase === "live" ? BAND : null }} onLayout={setLay}>
        {lay && lay.tower && (
          <div className="home-tower" aria-hidden="true">
            <img className="home-tower-coin" src={round?.coin.logo ?? "/stook-coin.svg"} alt="" style={{ left: lay.tower.left + lay.tower.width / 2, top: lay.tower.top - 52 }} />
            {tags.map((t) => lay.tower && (
              <span key={t.kind + t.text} className={`home-tag home-tag-${t.kind}`}
                style={t.kind === "now" ? { right: lay.width - lay.tower.left + 24, top: t.y } : { left: lay.tower.left + lay.tower.width + 32, top: t.y }}>{t.text}</span>
            ))}
          </div>
        )}
      </City>
      <div className="home-hero-in wrap">
        {round && a ? (
          <div className="home-today">
            <img src={round.coin.logo} alt="" />
            <span>${round.coin.symbol}</span>
            <span className="home-today-on">on {a.name}</span>
            {phase === "live" && <span className="home-live">Live</span>}
            {phase === "locked" && <span className="home-locked">Locked</span>}
          </div>
        ) : <div className="home-today"><img src="/stook-coin.svg" alt="" /><span>Stook Street</span></div>}
        <h1 className="home-h1">Where will {a ? a.symbol : "it"}<br />close at <em>{bellHour}?</em></h1>
        <div className="home-row">
          {q && a ? (
            <div className="home-price num">{fmtAnchor(q.price, a.dp)}
              {typeof q.change24h === "number" && <small className={q.change24h >= 0 ? "up" : "down"}>{fmtChange(q.change24h, 1)}</small>}
            </div>
          ) : round ? <div className="home-price home-price-wait">…</div> : null}
          <div className="home-cd" role="timer" aria-label={`${clock(until - now)} ${what}`}>
            <span className="count">{clock(until - now)}</span>
            <span className="home-cd-k">{what}</span>
          </div>
        </div>
        <div className="home-ctas">
          <Link className="btn" to={roundTo}>{cta} <span aria-hidden="true">→</span></Link>
          <WatchButton bare className="btn btn-ghost" label="60 s video" />
        </div>
      </div>
    </section>
  );
}

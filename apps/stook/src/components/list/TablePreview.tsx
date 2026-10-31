// How the coin's table would look on the trading floor: the same room, LED
// board and table as the home page, with two street tables beside it and
// traders walking between them (public/floor-life.js). The new table fills
// in as soon as a mint is pasted: logo, ticker, name, the anchor's price.
import { useEffect, useRef } from "react";
import type { PublicKey } from "@solana/web3.js";
import { COINS, anchorOf } from "../../lib/coins";
import { short } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { LedRing } from "../LedRing";
import { clock, nextBell } from "../home/Hero";
import { fmtAnchor } from "../home/useStreet";

export interface PreviewAnchor { name: string; symbol: string; logo: string | null; dp: number }

export function TablePreview({ mint, sym, name, logo, anchor, price, state }: {
  mint: PublicKey | null; sym: string; name: string | null; logo: string | null;
  anchor: PreviewAnchor | null; price: number | null; state: "empty" | "loading" | "ready" | "bad";
}) {
  const now = useNow();
  const posts = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let un: (() => void) | undefined, dead = false;
    const go = () => {
      const w = window as unknown as { StookFloor?: { mount: (el: HTMLElement, o: unknown) => () => void } };
      if (dead || !w.StookFloor || !posts.current) return;
      un = w.StookFloor.mount(posts.current, {
        tables: () => [...posts.current!.querySelectorAll<HTMLElement>("[data-coin]")].map((el) => ({ el, coin: el.dataset.coin })),
        data: () => ({}),
      });
    };
    if ((window as unknown as { StookFloor?: unknown }).StookFloor) go();
    else { const s = document.createElement("script"); s.src = "/floor-life.js"; s.onload = go; document.head.appendChild(s); }
    return () => { dead = true; un?.(); };
  }, []);
  const ny = new Date(now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  const side = [COINS[1], COINS[2]].filter(Boolean) as typeof COINS;
  return (
    <div className="hf list-floor" aria-label="Your table on the floor, a preview">
      <div className="hf-board list-floor-board" role="timer">
        <span className="hf-cell"><i>NY</i><b>{ny}</b></span>
        <span className="hf-mid">YOUR TABLE</span>
        <span className="hf-cell hf-cell-r"><i>bell in</i><b>{clock(nextBell(now) - now)}</b></span>
      </div>
      <div className="list-floor-posts" ref={posts}>
        {side[0] && <SideTable c={side[0]} pos="l" />}
        <div className={`list-floor-new list-floor-${state}`}>
          <div className="hf-table">
            <div className="hf-screen" data-coin={state === "ready" ? sym : "NEW"}>
              {state === "ready" ? (
                <>
                  <span className="hf-logos">{anchor?.logo && <img src={anchor.logo} alt="" />}{logo && <img src={logo} alt="" />}</span>
                  <span className="hf-sym">${sym}</span>
                  <span className="hf-plays">{anchor ? `plays ${anchor.name}` : "pick what it follows"}</span>
                  <span className="hf-px num">{anchor && price !== null ? fmtAnchor(price, anchor.dp) : anchor ? anchor.symbol : "?"}</span>
                </>
              ) : state === "loading" ? (
                <><i className="list-skel list-skel-dot" /><i className="list-skel list-skel-line" /><i className="list-skel list-skel-line short" /></>
              ) : (
                <><span className="list-floor-plus pix">+</span><span className="hf-sym">{state === "bad" ? "NOT THIS ONE" : "YOUR COIN"}</span><span className="hf-plays">{state === "bad" ? "see the note" : "paste a mint"}</span></>
              )}
            </div>
            {state === "ready" && <LedRing symbol={sym} usd={undefined} change={undefined} />}
          </div>
          <div className="list-floor-cap">
            {state === "ready"
              ? <><b>{name || `$${sym}`}</b><span className="dimmer">{mint ? short(mint) : ""}</span></>
              : <span className="dimmer">An empty table, waiting</span>}
          </div>
        </div>
        {side[1] && <SideTable c={side[1]} pos="r" />}
      </div>
    </div>
  );
}

function SideTable({ c, pos }: { c: (typeof COINS)[number]; pos: "l" | "r" }) {
  const a = anchorOf(c);
  return (
    <div className={`list-floor-side list-floor-side-${pos}`} aria-hidden="true">
      <div className="hf-table">
        <div className="hf-screen" data-coin={c.symbol}>
          <span className="hf-logos"><img src={c.anchor.logo} alt="" /><img src={c.logo} alt="" /></span>
          <span className="hf-sym">${c.symbol}</span>
          <span className="hf-plays">plays {a.name}</span>
        </div>
      </div>
    </div>
  );
}

// List a coin: the page for a coin's team or holders who want to put it to
// work on Stook Street. On devnet, the self-serve listing (`coin_list`):
// lock $200 or more of the coin (at most 5% of supply) as the house's seed, on an anchor from the
// street's list, and the daily rounds start a day later. On mainnet, where
// the program's build turns self-serve listing off, an application instead.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { isDevnet } from "../lib/coins";
import { LISTABLE, useListed } from "../lib/listed";
import { Title } from "../components/Title";
import { ListHero } from "../components/list/ListHero";
import { Faq, Gets, Needs, Recent } from "../components/list/Pitch";
import { TablePreview } from "../components/list/TablePreview";
import { ListFlow } from "../components/list/ListFlow";
import { ApplyForm, isContact } from "../components/list/ApplyForm";
import { useListing } from "../components/list/useListing";

export function List() {
  const { connection } = useConnection();
  const L = useListing();
  const listed = useListed(connection);
  // `?apply` opens the application on devnet too (for coins that need approval, or a link from a chat).
  const [params] = useSearchParams();
  const [apply, setApply] = useState(!isDevnet || params.has("apply"));
  const [asset, setAsset] = useState("");
  const [seedNote, setSeedNote] = useState("");
  const [contact, setContact] = useState("");
  const toApply = () => { setApply(true); document.getElementById("list-desk")?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const previewState = !L.mint ? "empty" : L.coinLoading ? "loading" : L.look.data && (!L.problem || (apply && L.problem.kind === "trusted")) ? "ready" : "bad";
  const anchors = (L.anchors.data ?? []).map((a) => LISTABLE[a.hex]!).filter(Boolean);
  // In the application the asset is free text: the preview names it, priced only when it is a known anchor.
  const known = apply ? Object.values(LISTABLE).find((a) => a.symbol.toUpperCase() === asset.trim().toUpperCase()) : L.anchor;
  const preAnchor = known ? { name: known.name, symbol: known.symbol, logo: known.logo, dp: known.dp } : apply && asset.trim() ? { name: asset.trim(), symbol: asset.trim().toUpperCase(), logo: null, dp: 2 } : null;
  const showLogo = previewState === "ready" ? L.logo : null;

  return (
    <div className="list">
      <Title text="List your coin" />
      <ListHero logo={showLogo} sym={previewState === "ready" ? L.sym : ""} apply={apply} />
      <div className="wrap list-body">
        <Gets sym={previewState === "ready" ? L.sym : ""} />
        <Needs apply={apply} feeSol={L.feeSol} totalSol={L.totalSol} anchors={anchors}
          done={apply
            ? { token: previewState === "ready", anchor: !!asset.trim(), seed: !!seedNote.trim(), last: isContact(contact) }
            : { token: L.coinOk, anchor: !!L.anchor && L.coinOk, seed: L.seedOk, last: L.solOk }} />

        <section className="list-sec list-desk" id="list-desk" aria-labelledby="list-desk-h">
          <div className="list-sec-head">
            <span className="kicker taxi">{apply ? "APPLY" : `SELF-SERVE${isDevnet ? " · DEVNET" : ""}`}</span>
            <h2 id="list-desk-h">{apply ? "Apply to list your coin" : "List your coin"}</h2>
            <p className="dim">{apply
              ? "Tell us the coin and what it should follow. We check the mint and the price source, then set up its table with you."
              : "Four steps, one signature. Anyone can list any coin."}</p>
          </div>
          <div className="list-desk-grid">
            <div className="list-desk-main">
              {apply ? <ApplyForm L={L} f={{ asset, setAsset, seed: seedNote, setSeed: setSeedNote, contact, setContact }} onBack={isDevnet ? () => setApply(false) : undefined} /> : <ListFlow L={L} onApply={toApply} />}
            </div>
            <aside className="list-desk-side">
              <span className="kicker">PREVIEW</span>
              <TablePreview mint={L.mint} sym={L.sym} name={L.look.data?.meta?.name ?? null} logo={L.logo}
                anchor={preAnchor} price={apply && preAnchor?.symbol !== L.anchor?.symbol ? null : L.price} state={previewState} />
              <p className="list-hint">This is how your table looks on the trading floor. Traders see its logo, ticker and the price it plays.</p>
            </aside>
          </div>
        </section>

        <Recent coins={listed.coins} ready={listed.ready} />
        <Faq feeSol={L.feeSol} totalSol={L.totalSol} apply={apply} />
      </div>
    </div>
  );
}

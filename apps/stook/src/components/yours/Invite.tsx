// The desk before there is anything on it: no wallet yet, a wallet with no
// rounds, the chain still reading, or the chain out of reach.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConnectWallet } from "../ConnectWallet";
import { Faucet } from "../Faucet";
import { FAUCET_AUTHORITY_BYTES } from "../../lib/config";
import { PixelBell, PixelCall, PixelCoins, PixelDesk, PixelVault } from "./art";

/** No wallet: the empty desk, what lands on it, and the one way in. */
export function Invite() {
  return (
    <div className="yours-invite">
      <div className="card yours-invite-main">
        <PixelDesk lit={false} className="yours-invite-art" />
        <div className="yours-invite-copy">
          <span className="kicker taxi">AN EMPTY DESK</span>
          <h2>Connect to open your desk</h2>
          <p className="dim">Your calls, your house stakes and every payout, for every table, in one place. Nothing to sign to look.</p>
          <div className="yours-connect"><ConnectWallet>Connect a wallet</ConnectWallet></div>
          <p className="yours-invite-links dimmer">Just looking? <Link to="/#floor">Pick a table ›</Link> or <Link to="/how">take the walk through ›</Link></p>
        </div>
      </div>
      <ol className="yours-preview" aria-label="What your desk shows">
        <li className="card"><span className="yours-ico yours-ico-now"><PixelCall /></span><div><b>Open calls</b><p className="dimmer">Each call on its floors, the price now marked, and what it is worth if you sell.</p></div></li>
        <li className="card"><span className="yours-ico yours-ico-up"><PixelCoins /></span><div><b>Ready to collect</b><p className="dimmer">Finished rounds on one payout slip. One button collects them all.</p></div></li>
        <li className="card"><span className="yours-ico yours-ico-taxi"><PixelBell size={36} /></span><div><b>Every bell</b><p className="dimmer">A ticket for each round you played: paid, got back, won or lost.</p></div></li>
      </ol>
    </div>
  );
}

/** Connected, nothing on the books yet: the ways in, in order. */
export function FirstSteps() {
  const steps = [
    FAUCET_AUTHORITY_BYTES && { t: "Get test coins", d: "Free on devnet: each table's coin, enough to try a few calls.", act: <Faucet /> },
    { t: "Make a call", d: "Pick a table, then the floor where you think today's price closes.", act: <Link className="btn btn-sm" to="/#floor">Pick a table <span aria-hidden="true">→</span></Link> },
    { t: "Or back the house", d: "Each coin's house funds every one of its rounds and keeps 90% of every fee.", act: <Link className="btn btn-sm btn-ghost" to="/c/STOOK#house">Back the house <span aria-hidden="true">→</span></Link> },
  ].filter(Boolean) as { t: string; d: string; act: ReactNode }[];
  return (
    <div className="yours-invite">
      <div className="card yours-invite-main">
        <PixelDesk className="yours-invite-art" />
        <div className="yours-invite-copy">
          <span className="kicker taxi">YOUR DESK IS OPEN</span>
          <h2>Nothing on the books yet</h2>
          <p className="dim">Make your first call and it shows up here, with the price now and what it pays.</p>
        </div>
      </div>
      <ol className="yours-steps">
        {steps.map((x, i) => <li key={x.t} className="card"><span className="yours-step-n pix">{i + 1}</span><div><b>{x.t}</b><p className="dimmer">{x.d}</p><div className="yours-step-act">{x.act}</div></div></li>)}
      </ol>
    </div>
  );
}

/** A tab with nothing in it: a picture, a line, one way forward. */
export function Empty({ art, title, line, to, cta, onGo }: { art: ReactNode; title: string; line: string; to: string; cta: string; onGo?: () => void }) {
  return (
    <div className="card yours-empty">
      <span className="yours-empty-ico">{art}</span>
      <div><h3>{title}</h3><p className="dim">{line}</p>{onGo ? <button className="btn btn-sm" onClick={onGo}>{cta} <span aria-hidden="true">→</span></button> : <Link className="btn btn-sm" to={to}>{cta} <span aria-hidden="true">→</span></Link>}</div>
    </div>
  );
}

export function Skeleton({ n = 4 }: { n?: number }) {
  return <div className="yours-grid" aria-busy="true" aria-label="Reading the books">{Array.from({ length: n }, (_, i) => <div key={i} className="card yours-skel"><i /><i /><i /><i /></div>)}</div>;
}

export function Trouble({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card yours-empty">
      <PixelVault className="yours-empty-art yours-dim-art" />
      <div><h3>The chain is out of reach</h3><p className="dim">We could not read this account just now. Nothing has moved; try again in a moment.</p><button className="btn btn-sm btn-ghost" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

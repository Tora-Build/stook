// The street coin's contract address, one tap to copy, in the header: the
// first thing a holder looks for. Nothing is drawn until the mint is known
// (VITE_STOOK_MINT), so devnet without a coin shows nothing here.
import { useState } from "react";
import { coinBySymbol } from "../lib/coins";

export function CopyCA() {
  const [copied, setCopied] = useState(false);
  // the real coin only (never the devnet twin): the address a holder pastes into a wallet
  const mint = coinBySymbol("SSt.")?.mint ?? "";
  if (!mint) return null;
  const copy = () => { navigator.clipboard?.writeText(mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {}); };
  return (
    <button className="ss-pill ss-ca" onClick={copy} title={`Copy the $SSt. contract address: ${mint}`} aria-label="Copy the $SSt. contract address">
      <span className="ss-ca-tag">{copied ? "CA ✓" : "CA"}</span>
      <span className="mono ss-ca-val">{copied ? "copied" : `${mint.slice(0, 4)}…${mint.slice(-4)}`}</span>
    </button>
  );
}

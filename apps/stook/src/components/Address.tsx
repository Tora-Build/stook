import { useState } from "react";

/** A mint address: monospace, click to copy, with a link to the explorer
 *  (`devnet`: Solscan's devnet view, for an address that lives there). */
export function Address({ value, label, dim, devnet }: { value: string; label?: string; dim?: boolean; devnet?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  return (
    <span className={`addr ${dim ? "addr-dim" : ""}`}>
      {label && <span className="addr-label">{label}</span>}
      <button className="addr-val mono" onClick={copy} title={copied ? "Copied" : "Copy"}>{value.slice(0, 6)}…{value.slice(-6)}{copied ? " ✓" : ""}</button>
      <a className="addr-link" href={`https://solscan.io/token/${value}${devnet ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer" title="Open in Solscan" aria-label="Open in Solscan">↗</a>
    </span>
  );
}

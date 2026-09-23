import { useState } from "react";

/** A mint address: monospace, click to copy, with a link to the explorer. */
export function Address({ value, label, dim }: { value: string; label?: string; dim?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  return (
    <span className={`addr ${dim ? "addr-dim" : ""}`}>
      {label && <span className="addr-label">{label}</span>}
      <button className="addr-val mono" onClick={copy} title="Copy">{value.slice(0, 6)}…{value.slice(-6)}{copied ? " ✓" : ""}</button>
      <a className="addr-link" href={`https://solscan.io/token/${value}`} target="_blank" rel="noreferrer" title="Solscan">↗</a>
    </span>
  );
}

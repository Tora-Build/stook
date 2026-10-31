// Apply to list: the path on mainnet (where self-serve listing is off) and
// for coins whose issuer keeps powers over holders. Sent to the site's
// /apply route; when that fails, the message is shown to copy into Telegram.
import { useState } from "react";
import { LISTABLE } from "../../lib/listed";
import { Notice } from "../Notice";
import { CoinStep, Step } from "./ListFlow";
import { parseKey } from "./data";
import type { Listing } from "./useListing";

const TG = "https://t.me/StookStreet", X = "https://x.com/StookStreet";
const isSource = (s: string) => { const t = s.trim(); return !t || /^(0x)?[0-9a-fA-F]{64}$/.test(t) || !!parseKey(t); };
export const isContact = (s: string) => /^@?[A-Za-z0-9_]{3,32}$/.test(s.trim()) || /^https:\/\/(t\.me|x\.com|twitter\.com)\/[A-Za-z0-9_]{3,32}\/?$/.test(s.trim());

/** The fields the page's checklist also reads, kept by the page. */
export interface ApplyFields { asset: string; setAsset: (s: string) => void; seed: string; setSeed: (s: string) => void; contact: string; setContact: (s: string) => void }

export function ApplyForm({ L, onBack, f }: { L: Listing; onBack?: () => void; f: ApplyFields }) {
  const { asset, setAsset, seed, setSeed, contact, setContact } = f;
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  const picked = Object.values(LISTABLE).find((a) => a.symbol === asset);
  const chips = (L.anchors.data?.length ? L.anchors.data.map((a) => LISTABLE[a.hex]!) : Object.values(LISTABLE)).slice(0, 6);

  const mint = L.mint;
  const errs = {
    mint: !mint ? "Paste the coin's mint." : null,
    asset: !asset.trim() ? "Name the asset its rounds follow." : null,
    source: !isSource(source) ? "A Pyth feed id is 64 hex characters; a pool is a Solana address." : null,
    contact: !isContact(contact) ? "A Telegram or X handle, like @name." : null,
  };
  const ok = !Object.values(errs).some(Boolean);
  const [tried, setTried] = useState(false);
  const body = { mint: mint?.toBase58() ?? "", symbol: L.sym, asset: asset.trim(), source: source.trim(), seed: seed.trim(), contact: contact.trim(), note: note.trim() };
  const message = [`List a coin on Stook Street`, `Coin: ${body.mint}${body.symbol ? ` ($${body.symbol})` : ""}`, `Follows: ${body.asset}`, body.source && `Price source: ${body.source}`, body.seed && `Seed: ${body.seed}`, `Contact: ${body.contact}`, body.note && `Note: ${body.note}`].filter(Boolean).join("\n");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setTried(true);
    if (!ok) return;
    setState("sending");
    try {
      const r = await fetch("/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = r.ok && r.headers.get("content-type")?.includes("json") ? await r.json() : null;
      setState(j?.ok ? "sent" : "failed");
    } catch { setState("failed"); }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { /* the text stays selectable */ } };

  if (state === "sent") return (
    <div className="card list-done">
      <div className="list-done-stub"><span className="kicker taxi">RECEIVED</span><b className="list-done-sym">{L.sym ? `$${L.sym}` : "Sent"}</b><span className="dim">on {body.asset}</span></div>
      <div className="list-done-copy">
        <h3>We have your application</h3>
        <p className="dim">We read every one and reply to {body.contact} on Telegram or X. Want to talk sooner? Message us.</p>
        <div className="list-done-ctas"><a className="btn btn-sm" href={TG} target="_blank" rel="noreferrer">Telegram</a><a className="btn btn-sm btn-ghost" href={X} target="_blank" rel="noreferrer">X</a></div>
      </div>
    </div>
  );

  const err = (k: keyof typeof errs) => tried && errs[k] ? <p className="list-hint list-hint-bad">{errs[k]}</p> : null;
  return (
    <form className="list-steps" onSubmit={(e) => void submit(e)} noValidate>
      {onBack && <button type="button" className="list-link list-back" onClick={onBack}>← Back to the self-serve listing</button>}
      <Step n={1} title="Your coin" done={L.coinOk || (!!mint && L.problem?.kind === "trusted")}><CoinStep L={L} apply />{err("mint")}</Step>
      <Step n={2} title="What it follows" sub="An asset with a Pyth feed or a Raydium concentrated pool." done={!errs.asset && !errs.source}>
        <div className="list-anchors list-anchors-sm" role="group" aria-label="Pick an asset">
          {chips.map((a) => <button type="button" key={a.symbol} className={`list-anchor ${asset === a.symbol ? "on" : ""}`} aria-pressed={asset === a.symbol} onClick={() => { setAsset(a.symbol); L.setFeed(a.feedId); }}><img src={a.logo} alt="" /><span><b>{a.name}</b><small>{a.symbol}</small></span></button>)}
        </div>
        <div className="list-grid2">
          <label className="list-field"><span className="label">Asset</span><input className="input" value={asset} onChange={(e) => setAsset(e.target.value.slice(0, 40))} placeholder="SOL, gold, a stock" /></label>
          <label className="list-field"><span className="label">Price source, if you know it</span><input className="input list-mint" value={source} onChange={(e) => setSource(e.target.value.slice(0, 90))} placeholder={picked ? "We know this one" : "Pyth feed id or pool address"} spellCheck={false} /></label>
        </div>
        {err("asset")}{err("source")}
      </Step>
      <Step n={3} title="Seed and contact" done={!errs.contact}>
        <div className="list-grid2">
          <label className="list-field"><span className="label">How much the team will seed</span><input className="input" value={seed} onChange={(e) => setSeed(e.target.value.slice(0, 60))} placeholder="e.g. 2% of supply" /></label>
          <label className="list-field"><span className="label">Telegram or X handle</span><input className="input" value={contact} onChange={(e) => setContact(e.target.value.slice(0, 60))} placeholder="@yourteam" autoComplete="off" /></label>
        </div>
        {err("contact")}
        <label className="list-field"><span className="label">A short note</span><textarea className="input list-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3} placeholder="Who you are, your community, anything we should know" /></label>
        <span className="list-count label">{note.length} / 500</span>
      </Step>
      {state === "failed" && (
        <Notice tone="warn" title="It did not send">
          Copy the message and send it to us on Telegram.
          <textarea className="input list-note list-copy" readOnly value={message} rows={6} onFocus={(e) => e.currentTarget.select()} />
          <span className="list-copy-row"><button type="button" className="btn btn-sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy the message"}</button><a className="btn btn-sm btn-ghost" href={TG} target="_blank" rel="noreferrer">Open Telegram</a></span>
        </Notice>
      )}
      <div className="list-apply-foot">
        <button className="btn btn-block" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending" : "Apply to list"} {state !== "sending" && <span aria-hidden="true">→</span>}</button>
        <p className="list-hint">Or message us: <a href={TG} target="_blank" rel="noreferrer">Telegram</a> · <a href={X} target="_blank" rel="noreferrer">X</a></p>
      </div>
    </form>
  );
}

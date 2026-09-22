import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { FEEDS } from "../lib/feeds";
import { QUOTE_MINT } from "../lib/config";
import { ataOf } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

const TIERS = stook.STEP_BPS.map((bps, i) => ({ tier: i, bps, label: `${bps / 100}%` }));
const hexToBytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g)!.map((b) => parseInt(b, 16)));

export function Create() {
  const nav = useNavigate();
  const { publicKey } = useWallet();
  const send = useSend("Market created");
  const [feedId, setFeedId] = useState(FEEDS[0]!.id);
  const [customFeed, setCustomFeed] = useState("");
  const [mintText, setMintText] = useState(QUOTE_MINT?.toBase58() ?? "");
  const [tier, setTier] = useState(2);
  const [opensIn, setOpensIn] = useState(5);      // minutes
  const [tradeFor, setTradeFor] = useState(60);   // minutes after open
  const [seedText, setSeedText] = useState("1000");
  const [feeBps, setFeeBps] = useState(100);

  const mintKey = useMemo(() => { try { return new PublicKey(mintText); } catch { return null; } }, [mintText]);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const dec = mint.data?.decimals ?? 6;
  const seed = parseAmount(seedText, dec);
  const feed = customFeed.trim() ? customFeed.trim().replace(/^0x/, "") : feedId;
  const feedOk = /^[0-9a-f]{64}$/i.test(feed);
  const verdict = mint.data?.report.verdict;

  const submit = () => {
    if (!publicKey || !mintKey || !mint.data || !seed || !feedOk) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const opensAt = now + BigInt(opensIn * 60);
    const locksAt = opensAt + BigInt(tradeFor * 60);
    const settlesAt = locksAt + 120n; // lock two minutes before the price is read
    send.mutate([stook.createLadderIx({
      feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier,
      creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram,
      opensAt, locksAt, seed, feeBps, issuerTrusted: verdict === "issuer-trusted",
    })], {
      onSuccess: () => nav(`/m/${stook.deriveLadderPda({ feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier }).toBase58()}`),
    });
  };

  return (
    <div className="page narrow">
      <h1>Create a market</h1>
      <p className="explain">Your seed is the market's first liquidity. It buys depth at even odds across all 64 bands, earns 80% of every fee, and the most it can lose is itself. Anyone can add more once the market exists.</p>

      <label className="field"><span>Asset (Pyth feed)</span>
        <select value={feedId} onChange={(e) => setFeedId(e.target.value)} disabled={!!customFeed.trim()}>
          {FEEDS.map((f) => <option key={f.id} value={f.id}>{f.symbol} — {f.name}</option>)}
        </select>
        <input placeholder="or paste any Pyth feed id (64 hex)" value={customFeed} onChange={(e) => setCustomFeed(e.target.value)} />
        {!feedOk && <span className="warn">Not a feed id.</span>}
      </label>

      <label className="field"><span>Quote token (mint)</span>
        <input value={mintText} onChange={(e) => setMintText(e.target.value)} />
        {mintKey && mint.data === null && <span className="warn">No mint at this address.</span>}
        {mint.data && (
          <span className={`hint ${verdict === "refused" ? "warn" : ""}`}>
            {mint.data.decimals} decimals · {verdict === "open" ? "any market may quote in it" : verdict === "issuer-trusted" ? "issuer holds powers over holders — needs protocol approval" : "cannot be held in a vault"}
            {mint.data.report.reasons.map((r) => <><br />{r}</>)}
          </span>
        )}
      </label>

      <label className="field"><span>Band width</span>
        <div className="seg">{TIERS.map((t) => <button key={t.tier} className={tier === t.tier ? "on" : ""} onClick={() => setTier(t.tier)}>{t.label}</button>)}</div>
        <span className="hint">64 bands, {stook.STEP_BPS[tier]! / 100}% apart, centred on the price when the market opens: it covers ±{(Math.exp(32 * stook.STEP_BPS[tier]! / 10_000) * 100 - 100).toFixed(0)}%.</span>
      </label>

      <div className="two">
        <label className="field"><span>Opens in (minutes)</span><input type="number" min={1} value={opensIn} onChange={(e) => setOpensIn(Number(e.target.value))} /></label>
        <label className="field"><span>Trades for (minutes)</span><input type="number" min={5} value={tradeFor} onChange={(e) => setTradeFor(Number(e.target.value))} /></label>
      </div>
      <p className="hint">Settlement reads the Pyth price two minutes after trading locks.</p>

      <div className="two">
        <label className="field"><span>Seed</span><input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="decimal" />
          <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"}</span></label>
        <label className="field"><span>Fee (bps)</span><input type="number" min={1} max={500} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} /></label>
      </div>

      <button className="primary" disabled={!publicKey || !seed || !feedOk || verdict === "refused" || !mint.data || send.isPending} onClick={submit}>
        {!publicKey ? "Connect a wallet" : send.isPending ? "Creating…" : "Create market"}
      </button>
    </div>
  );
}

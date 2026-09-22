import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { FEEDS } from "../lib/feeds";
import { COINS, mintOf } from "../lib/coins";
import { QUOTE_MINT } from "../lib/config";
import { ataOf } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

const TIERS = stook.STEP_BPS.map((bps, i) => ({ tier: i, bps, label: `${bps / 100}%` }));
const hexToBytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g)!.map((b) => parseInt(b, 16)));

export function Create() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { publicKey } = useWallet();
  const send = useSend("Round created");
  const first = COINS.find((c) => c.symbol === params.get("coin") && mintOf(c)) ?? COINS.find((c) => mintOf(c)) ?? COINS[0]!;
  const [coinSym, setCoinSym] = useState<string>(first.symbol);           // a street coin, or "custom"
  const coin = COINS.find((c) => c.symbol === coinSym) ?? null;
  const [feedId, setFeedId] = useState(FEEDS[0]!.id);
  const [customFeed, setCustomFeed] = useState("");
  const [mintText, setMintText] = useState(QUOTE_MINT?.toBase58() ?? "");
  const [tier, setTier] = useState(2);
  const slot = params.get("settles") ? Number(params.get("settles")) : null;   // a fixed hour from the coin page
  const [opensIn, setOpensIn] = useState(slot ? 1 : 5);      // minutes
  const [tradeFor, setTradeFor] = useState(60);   // minutes after open
  const [seedText, setSeedText] = useState("1000");
  const [feeBps, setFeeBps] = useState(100);

  const mintKey = useMemo(() => { try { return new PublicKey(mintText); } catch { return null; } }, [mintText]);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const dec = mint.data?.decimals ?? 6;
  const seed = parseAmount(seedText, dec);
  const feed = coin ? coin.anchor.feedId : customFeed.trim() ? customFeed.trim().replace(/^0x/, "") : feedId;
  const feedOk = /^[0-9a-f]{64}$/i.test(feed);
  const pick = (sym: string) => { setCoinSym(sym); const c = COINS.find((x) => x.symbol === sym); const m = c ? mintOf(c) : null; setMintText(m ? m.toBase58() : c ? "" : QUOTE_MINT?.toBase58() ?? ""); };
  const verdict = mint.data?.report.verdict;

  const submit = () => {
    if (!publicKey || !mintKey || !mint.data || !seed || !feedOk) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const opensAt = now + BigInt(opensIn * 60);
    // A slot from the coin page fixes the settlement hour; trading locks two minutes before it.
    const settlesAt = slot ? BigInt(slot) : opensAt + BigInt(tradeFor * 60) + 120n;
    const locksAt = settlesAt - 120n;
    send.mutate([stook.createLadderIx({
      creator: publicKey, feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier,
      creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram,
      opensAt, locksAt, seed, feeBps, issuerTrusted: verdict === "issuer-trusted",
    })], {
      onSuccess: () => nav(`/m/${stook.deriveLadderPda({ creator: publicKey, feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier }).toBase58()}`),
    });
  };

  return (
    <div className="page narrow">
      <h1>Open a round</h1>
      <p className="explain">A round is on a coin's anchor stock and in the coin. Your seed is its first liquidity: it buys depth at even odds across all 64 bands, earns 80% of every fee, and the most it can lose is itself. Anyone can add more once the round exists.</p>

      <label className="field"><span>Coin</span>
        <div className="seg seg-wrap">
          {COINS.filter((c) => mintOf(c)).map((c) => <button key={c.symbol} className={coinSym === c.symbol ? "on" : ""} onClick={() => pick(c.symbol)}>${c.symbol}</button>)}
          <button className={coinSym === "custom" ? "on" : ""} onClick={() => pick("custom")}>custom</button>
        </div>
        {coin && <span className="hint">Rounds on <b>{coin.anchor.name}</b> ({coin.anchor.symbol}), {coin.anchor.hours === "24/7" ? "any time" : `settling inside ${coin.anchor.hours}`}. Quoted in ${coin.symbol}; the coin takes {coin.feeBps / 100}% on every transfer.</span>}
      </label>

      {!coin && (
        <label className="field"><span>Asset (Pyth feed)</span>
          <select value={feedId} onChange={(e) => setFeedId(e.target.value)} disabled={!!customFeed.trim()}>
            {FEEDS.map((f) => <option key={f.id} value={f.id}>{f.symbol} — {f.name}</option>)}
          </select>
          <input placeholder="or paste any Pyth feed id (64 hex)" value={customFeed} onChange={(e) => setCustomFeed(e.target.value)} />
          {!feedOk && <span className="warn">Not a feed id.</span>}
        </label>
      )}

      <label className="field"><span>Quote token (mint)</span>
        <input value={mintText} onChange={(e) => setMintText(e.target.value)} readOnly={!!coin} />
        {mintKey && mint.data === null && <span className="warn">No mint at this address.</span>}
        {mint.data && (
          <span className={`hint ${verdict === "refused" ? "warn" : ""}`}>
            {mint.data.decimals} decimals · {verdict === "open" ? "any market may quote in it" : verdict === "issuer-trusted" ? "needs protocol approval" : "cannot be held in a vault"}
            {mint.data.report.reasons.map((r) => <><br />{r}</>)}
          </span>
        )}
      </label>

      <label className="field"><span>Band width</span>
        <div className="seg">{TIERS.map((t) => <button key={t.tier} className={tier === t.tier ? "on" : ""} onClick={() => setTier(t.tier)}>{t.label}</button>)}</div>
        <span className="hint">64 bands, {stook.STEP_BPS[tier]! / 100}% apart, centred on the price when the market opens: it covers ±{(Math.exp(32 * stook.STEP_BPS[tier]! / 10_000) * 100 - 100).toFixed(0)}%.</span>
      </label>

      {slot ? (
        <p className="hint">Settles <b>{new Date(slot * 1000).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</b>; trading opens in a minute and locks two minutes before settlement.</p>
      ) : (
        <>
          <div className="two">
            <label className="field"><span>Opens in (minutes)</span><input type="number" min={1} value={opensIn} onChange={(e) => setOpensIn(Number(e.target.value))} /></label>
            <label className="field"><span>Trades for (minutes)</span><input type="number" min={5} value={tradeFor} onChange={(e) => setTradeFor(Number(e.target.value))} /></label>
          </div>
          <p className="hint">Settlement reads the Pyth price two minutes after trading locks.</p>
        </>
      )}

      <div className="two">
        <label className="field"><span>Seed</span><input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="decimal" />
          <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"}</span></label>
        <label className="field"><span>Fee (bps)</span><input type="number" min={1} max={500} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} /></label>
      </div>

      <button className="primary" disabled={!publicKey || !seed || !feedOk || verdict === "refused" || !mint.data || send.isPending} onClick={submit}>
        {!publicKey ? "Connect a wallet" : send.isPending ? "Opening…" : "Open the round"}
      </button>
    </div>
  );
}

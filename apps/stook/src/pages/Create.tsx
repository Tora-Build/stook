import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { FEEDS } from "../lib/feeds";
import { COINS, anchorOf, mintOf, standInNote } from "../lib/coins";
import { BandPreview } from "../components/BandPreview";
import { useLivePrice } from "../hooks/useChain";
import { useLadders } from "../hooks/useChain";
import { QUOTE_MINT } from "../lib/config";
import { ataOf } from "../lib/chain";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { fmtAmount, parseAmount } from "../lib/format";

const TIERS = stook.STEP_BPS.map((bps, i) => ({ tier: i, bps, label: `${bps / 100}%` }));
const hexToBytes = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const feedOkBytes = (h: string) => (/^[0-9a-f]{64}$/i.test(h) ? hexToBytes(h) : null);

export function Create() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { publicKey } = useWallet();
  const send = useSend("Round started");
  const first = COINS.find((c) => c.symbol === params.get("coin") && mintOf(c)) ?? COINS.find((c) => mintOf(c)) ?? COINS[0]!;
  const [coinSym, setCoinSym] = useState<string>(first.symbol);           // a street coin, or "custom"
  const coin = COINS.find((c) => c.symbol === coinSym) ?? null;
  const [feedId, setFeedId] = useState(FEEDS[0]!.id);
  const [customFeed, setCustomFeed] = useState("");
  const [mintText, setMintText] = useState(() => { const m = mintOf(first); return m ? m.toBase58() : QUOTE_MINT?.toBase58() ?? ""; });
  const [tier, setTier] = useState(2);
  const slot = params.get("settles") ? Number(params.get("settles")) : null;   // a fixed day from the coin page
  const [settlesIn, setSettlesIn] = useState(60);   // minutes, when no slot was given
  const ladders = useLadders();
  const [seedText, setSeedText] = useState("1000");

  const mintKey = useMemo(() => { try { return new PublicKey(mintText); } catch { return null; } }, [mintText]);
  const mint = useMint(mintKey);
  const balance = useBalance(mintKey, mint.data?.tokenProgram);
  const dec = mint.data?.decimals ?? 6;
  const seed = parseAmount(seedText, dec);
  const feed = coin ? anchorOf(coin).feedId : customFeed.trim() ? customFeed.trim().replace(/^0x/, "") : feedId;
  const live = useLivePrice(feedOkBytes(feed));
  const livePrice = live.data && live.data.price > 0n ? Number(live.data.price) * 10 ** live.data.expo : null;
  const dp = coin ? anchorOf(coin).dp : FEEDS.find((f) => f.id === feed)?.dp ?? 2;
  const feedOk = /^[0-9a-f]{64}$/i.test(feed);
  const pick = (sym: string) => { setCoinSym(sym); const c = COINS.find((x) => x.symbol === sym); const m = c ? mintOf(c) : null; setMintText(m ? m.toBase58() : c ? "" : QUOTE_MINT?.toBase58() ?? ""); };
  const verdict = mint.data?.report.verdict;

  // The round is canonical: if this slot already exists, there is nothing to start — go and add liquidity to it.
  const settlesAt = slot ? BigInt(slot) : BigInt(Math.floor(Date.now() / 1000) + settlesIn * 60);
  const existing = feedOk && mintKey ? (() => { const k = stook.deriveLadderPda({ feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier }).toBase58(); return ladders.data?.find((r) => r.pubkey.toBase58() === k) ?? null; })() : null;

  const submit = () => {
    if (!publicKey || !mintKey || !mint.data || !seed || !feedOk) return;
    send.mutate([stook.createLadderIx({
      feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier,
      creator: publicKey, creatorToken: ataOf(mintKey, publicKey, mint.data.tokenProgram), tokenProgram: mint.data.tokenProgram,
      seed, issuerTrusted: verdict === "issuer-trusted",
    })], {
      onSuccess: () => nav(`/m/${stook.deriveLadderPda({ feedId: hexToBytes(feed), settlesAt, quoteMint: mintKey, tier }).toBase58()}`),
    });
  };

  return (
    <div className="page narrow">
      <h1>Start a round</h1>
      <p className="explain">A round is on a coin's anchor and in the coin. Your seed is its first liquidity: it buys depth at even odds across all 64 bands, earns 80% of every fee, and the most it can lose is itself. There is one round per coin and day; once it exists, everyone else adds to it.</p>

      <label className="field"><span>Coin</span>
        <div className="seg seg-wrap">
          {COINS.filter((c) => mintOf(c)).map((c) => <button key={c.symbol} className={coinSym === c.symbol ? "on" : ""} onClick={() => pick(c.symbol)}>${c.symbol}</button>)}
          <button className={coinSym === "custom" ? "on" : ""} onClick={() => pick("custom")}>custom</button>
        </div>
        {coin && <span className="hint">Rounds on <b>{anchorOf(coin).name}</b>, paid in ${coin.symbol}; the coin takes {coin.feeBps / 100}% on every transfer.{standInNote(coin) && <><br /><span className="warn">{standInNote(coin)}</span></>}</span>}
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

      <label className="field"><span>How fine the bands are</span>
        <div className="seg">{TIERS.map((t) => <button key={t.tier} className={tier === t.tier ? "on" : ""} onClick={() => setTier(t.tier)}>{t.label}</button>)}</div>
        <BandPreview price={livePrice} stepBps={stook.STEP_BPS[tier]!} dp={dp} />
      </label>

      {slot ? (
        <p className="hint">Settles <b>{new Date(slot * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>. Trading opens a minute after you start it and locks two minutes before settlement.</p>
      ) : (
        <label className="field"><span>Settles in (minutes)</span><input type="number" min={15} value={settlesIn} onChange={(e) => setSettlesIn(Number(e.target.value))} />
          <span className="hint">Trading opens a minute after you start it and locks two minutes before settlement.</span></label>
      )}

      <label className="field"><span>Your seed (first liquidity)</span><input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="decimal" />
        <span className="hint">balance {balance.data !== undefined ? fmtAmount(balance.data, dec) : "—"} · every round charges a 1% fee, 80% of it to liquidity</span></label>

      {existing ? (
        <button className="primary" onClick={() => nav(`/m/${existing.pubkey.toBase58()}`)}>This round already exists — add liquidity to it</button>
      ) : (
        <button className="primary" disabled={!publicKey || !seed || !feedOk || verdict === "refused" || !mint.data || send.isPending} onClick={submit}>
          {!publicKey ? "Connect a wallet" : send.isPending ? "Starting…" : "Start the round"}
        </button>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { Chart, type DrawMode } from "../components/Chart";
import { Ticket } from "../components/Ticket";
import { Address } from "../components/Address";
import { useLadder, useLivePrice, useMint, usePositions, useRefs, useSend, useTranches } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { feedByHex, feedHex } from "../lib/feeds";
import { coinByMint } from "../lib/coins";
import { fmtAmount, fmtPrice, untilText } from "../lib/format";

export function Market() {
  const { id } = useParams();
  const key = useMemo(() => { try { return new PublicKey(id!); } catch { return null; } }, [id]);
  const ladder = useLadder(key);
  const l = ladder.data;
  const mint = useMint(l?.quoteMint ?? null);
  const refs = useRefs(key, l, mint.data?.tokenProgram);
  const now = useNow();
  const { publicKey } = useWallet();
  const [shape, setShape] = useState<stook.Shape | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<DrawMode>("line");
  const [height, setHeight] = useState(4);
  const live = useLivePrice(l?.feedId ?? null);
  const feedSym = l ? feedByHex(feedHex(l.feedId)).symbol : null;
  const history = useQuery({ queryKey: ["hist", feedSym], queryFn: async () => (await fetch(`/chart?sym=${feedSym}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!feedSym, refetchInterval: 300_000 });
  const positions = usePositions(key);
  const tranches = useTranches(key, true);
  const voidIt = useSend("Void");

  if (!key) return <p className="page muted">Not a round address.</p>;
  if (ladder.isLoading) return <p className="page muted">Reading the round…</p>;
  if (!l || !refs) return <p className="page muted">{l === null ? "No round at this address." : "Reading the quote token…"}</p>;

  const feed = feedByHex(feedHex(l.feedId));
  const coin = coinByMint(l.quoteMint);
  const quoteSymbol = coin ? coin.symbol : mint.data?.decimals === 6 ? "USDC" : "tokens";
  const tradeable = l.status === "open" && now < Number(l.locksAt);
  const final = l.status === "settled" || l.status === "void";
  const step = stook.nextStep(l, BigInt(now));
  const mine = (positions.data ?? []).filter((r) => r.position.shares > 0n || final);
  const sel = mine.find((r) => r.pubkey.toBase58() === selected) ?? null;
  const setHeightAndShape = (h: number) => { setHeight(h); if (shape && shape.h > 1) setShape(stook.tent((shape.lo + shape.hi) / 2, h)); };
  const livePrice = live.data && live.data.price > 0n ? Number(live.data.price) * 10 ** live.data.expo : null;
  const stateText = l.status === "seeding" ? (step === "void" ? "never opened" : "opening") : l.status === "open" ? (now < Number(l.locksAt) ? `trading · locks in ${untilText(l.locksAt, now)}` : step === "settle" ? "the bell is ringing" : `locked · bell in ${untilText(l.settlesAt, now)}`) : l.status === "settled" ? `landed in band ${l.settledBin}` : "void";

  return (
    <div className="page market">
      <header className="strip-head">
        <div className="strip-id">
          {coin && <div className="logos"><img src={coin.logo} alt="" className="logo-coin" /><img src={coin.anchor.logo} alt="" className="logo-anchor" /></div>}
          <div>
            <div className="strip-title">{feed.name} <span className="sym">{feed.symbol}</span>{coin && <span className="strip-coin"> · in ${coin.symbol}</span>}</div>
            <div className="muted small">closes {new Date(Number(l.settlesAt) * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{coin && <> · <Address label={`${coin.anchor.symbol}`} value={coin.anchor.mint} /></>}</div>
          </div>
        </div>
        <div className="strip-num"><span className="strip-k">price</span><span className="mono strip-v">{livePrice !== null ? `$${fmtPrice(BigInt(Math.round(livePrice / 10 ** live.data!.expo)), live.data!.expo, feed.dp)}` : "—"}</span></div>
        <div className="strip-num"><span className="strip-k">pool</span><span className="mono strip-v">{fmtAmount(l.depositTotal, l.decimals, 0)} <span className="muted">{quoteSymbol}</span></span></div>
        <div className={`status status-${l.status}`}>{stateText}</div>
      </header>

      <div className="market-grid">
        <Chart
          curve={l.curve} p0={l.p0 || (live.data?.price ?? 1n)} expo={l.p0Expo || (live.data?.expo ?? -8)} stepBps={l.stepBps} dp={feed.dp}
          shape={shape} onShape={setShape} mode={mode} height={height}
          live={live.data && live.data.price > 0n ? { price: live.data.price } : null} history={history.data?.points} settlesAt={l.settlesAt} now={now}
          settledBin={l.settledBin} disabled={!tradeable}
          positions={mine.map((r) => ({ key: r.pubkey.toBase58(), shape: r.position.shape, shares: r.position.shares, label: `${fmtAmount(r.position.shares, l.decimals, 0)} sh` }))}
          selected={selected} onSelect={setSelected}
        />
        <Ticket refs={refs} ladder={l} shape={shape} selected={sel} onSelect={(r) => { setSelected(r.pubkey.toBase58()); setShape(r.position.shape); }} onDeselect={() => { setSelected(null); setShape(null); }} mode={mode} setMode={setMode} height={height} setHeight={setHeightAndShape}
          symbol={feed.symbol} dp={feed.dp} quoteSymbol={quoteSymbol} tradeable={tradeable} final={final} positions={mine} tranches={tranches.data ?? []} transferFee={mint.data?.report.transferFee} now={now} />
      </div>
      {step === "void" && publicKey && <p className="hint"><button className="link" onClick={() => voidIt.mutate([stook.voidLadderIx(refs, publicKey)])} disabled={voidIt.isPending}>This round cannot finish — void it and refund everyone</button></p>}
    </div>
  );
}

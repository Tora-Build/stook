// List your coin: lock 0.5% to 5% of a coin's supply as the seed of its own
// house, on an anchor from the street's list, and the coin's daily rounds
// start a day later (program: `coin_list`).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
import { Connection } from "@solana/web3.js";
import { SCAN_RPC_URL } from "../lib/config";
import { ataOf } from "../lib/chain";
import { fmtCompact, parseAmount } from "../lib/format";
import { nyWhen } from "../lib/time";
import { coinByMint } from "../lib/coins";
import { LISTABLE, parseMetaplex, parseToken2022Meta, reloadListed, type TokenMeta } from "../lib/listed";
import { useBalance, useMint, useSend } from "../hooks/useChain";
import { Notice } from "../components/Notice";
import { Title } from "../components/Title";

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SHARES = [50n, 100n, 250n, 500n]; // of 10,000: 0.5%, 1%, 2.5%, 5%

const parseKey = (s: string) => { try { return new PublicKey(s.trim()); } catch { return null; } };

export function List() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [mintText, setMintText] = useState("");
  const mint = useMemo(() => parseKey(mintText), [mintText]);
  const [feed, setFeed] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [listed, setListed] = useState<{ symbol: string; at: bigint } | null>(null);

  const anchors = useQuery({
    queryKey: ["list-anchors"],
    queryFn: async () => {
      const scanner = new Connection(SCAN_RPC_URL, "confirmed");
      const all = await scanner.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.listAnchorFilters() });
      return all.map((a) => stook.decodeListAnchor(a.account.data)).filter((a) => a.active).map((a) => ({ ...a, hex: Buffer.from(a.feedId).toString("hex") })).filter((a) => LISTABLE[a.hex]);
    },
    staleTime: 300_000,
  });
  const config = useQuery({
    queryKey: ["protocol-config"],
    queryFn: async () => { const a = await connection.getAccountInfo(stook.deriveProtocolConfig()); return a ? stook.decodeProtocolConfig(a.data) : null; },
    staleTime: 300_000,
  });
  const info = useMint(mint).data;
  const coin = useQuery({
    queryKey: ["list-coin", mint?.toBase58()],
    enabled: !!mint,
    queryFn: async () => {
      const meta = PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), METADATA_PROGRAM.toBytes(), mint!.toBytes()], METADATA_PROGRAM)[0];
      const [m, md] = await connection.getMultipleAccountsInfo([mint!, meta]);
      if (!m) return null;
      const supply = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength).getBigUint64(36, true);
      const t: TokenMeta | null = (md ? parseMetaplex(md.data) : null) ?? parseToken2022Meta(new Uint8Array(m.data));
      return { supply, meta: t };
    },
  });
  const balance = useBalance(mint, info?.tokenProgram);
  const send = useSend("Listing");

  const chosen = feed ?? anchors.data?.[0]?.hex ?? null;
  const anchor = chosen ? LISTABLE[chosen] : null;
  const dec = info?.decimals ?? 0;
  const sym = (coin.data?.meta?.symbol || "").toUpperCase() || (mint ? mint.toBase58().slice(0, 4) : "");
  const supply = coin.data?.supply ?? 0n;
  const [min, max] = stook.seedBounds(supply);
  const seed = parseAmount(text, dec);
  const fee = info?.report.transferFee;
  const gross = seed ? stook.grossFor(seed, fee) : null;
  const series = mint && chosen ? stook.deriveSeries(Uint8Array.from(Buffer.from(chosen, "hex")), mint, 0) : null;
  const taken = useQuery({ queryKey: ["series-exists", series?.toBase58()], enabled: !!series, queryFn: async () => !!(await connection.getAccountInfo(series!)) });
  const street = mint ? coinByMint(mint) : undefined;
  const amt = (v: bigint) => `${fmtCompact(v, dec)} ${sym}`;

  const problem =
    !mint ? null
    : coin.isLoading || !info ? null
    : !coin.data ? "No coin at that address on this network."
    : info.report.verdict === "refused" ? `The street cannot hold this coin: ${info.report.reasons.join("; ")}.`
    : info.report.verdict === "issuer-trusted" ? `This coin's issuer keeps powers over holders (${info.report.reasons.join("; ")}). The street has to approve it first; ask us.`
    : street && !("listing" in street) ? `$${street.symbol} is already on the street.`
    : taken.data ? `${sym || "This coin"} is already listed on ${anchor?.symbol}.`
    : null;
  const seedProblem = seed === null ? null : seed < min ? `The seed must be at least ${amt(min)}, 0.5% of the supply.` : seed > max ? `The seed may be at most ${amt(max)}, 5% of the supply.` : balance.data !== undefined && gross !== null && balance.data < gross ? `Your wallet holds ${amt(balance.data)}.` : null;
  const ready = !!publicKey && !!mint && !!info && !!coin.data && !!anchor && !!config.data && seed !== null && !problem && !seedProblem;

  async function list() {
    if (!ready || !publicKey || !mint || !info || !seed || !chosen || !config.data) return;
    const ix = stook.coinListIx({
      lister: publicKey, listerToken: ataOf(mint, publicKey, info.tokenProgram), feedId: Uint8Array.from(Buffer.from(chosen, "hex")), quoteMint: mint,
      tokenProgram: info.tokenProgram, treasury: config.data.treasury, seed, maxGross: stook.maxGrossFor(seed, [fee]),
    });
    await send.mutateAsync({ ixs: [ix], computeUnits: 250_000 });
    await reloadListed(connection);
    setListed({ symbol: sym, at: BigInt(Math.floor(Date.now() / 1000)) + stook.LIST_DELAY_SECS });
  }

  return (
    <div className="page">
      <Title text="List your coin" />
      <h1>List your coin</h1>
      <p className="muted">Give your coin its own daily rounds. Lock some of it as the seed of the coin's house, pick the price it follows, and the first round opens a day later. Anyone can list any coin.</p>

      <section className="panel">
        <h3>How it works</h3>
        <ol className="steps">
          <li><b>Lock 0.5% to 5% of the supply.</b> It becomes the first money in your coin's house, which funds every round. It stays a week, then you can take it out at any bell.</li>
          <li><b>Pick what it follows.</b> Rounds settle on that price at 4 PM New York, from Pyth.</li>
          <li><b>Live in a day.</b> The street can turn a listing down in that day; if it does, your seed comes back at once.</li>
        </ol>
        <p className="hint">The house takes the other side of every call: it earns 90% of the trading fees and pays the callers who land close. The seed can grow or shrink.</p>
      </section>

      {listed ? (
        <section className="panel">
          <Notice tone="info" title={`$${listed.symbol} is listed`}>Its rounds start {nyWhen(Number(listed.at), { weekday: "short", hour: "numeric", minute: "2-digit" })} New York. <Link to={`/c/${listed.symbol}`}>See its page ›</Link></Notice>
        </section>
      ) : (
        <section className="panel">
          <div className="field">
            <div className="amount-head"><span>The coin's mint address</span></div>
            <input className="mono" value={mintText} onChange={(e) => setMintText(e.target.value)} placeholder="Paste the mint" aria-label="Mint address" spellCheck={false} />
            {mint && coin.data && <span className="hint">{coin.data.meta?.name || "No name"} · ${sym} · supply {fmtCompact(supply, dec)}{fee ? ` · ${(fee.bps / 100).toFixed(1)}% transfer fee` : ""}</span>}
            {mintText && !mint && <span className="hint">That is not a Solana address.</span>}
          </div>
          {problem && <Notice tone="stop" title="Not this coin">{problem}</Notice>}

          <div className="field">
            <div className="amount-head"><span>It follows</span></div>
            <div className="pb-coins" role="group" aria-label="Anchor">
              {(anchors.data ?? []).map((a) => {
                const x = LISTABLE[a.hex]!;
                return <button key={a.hex} className={`pb-chip ${chosen === a.hex ? "on" : ""}`} aria-pressed={chosen === a.hex} onClick={() => setFeed(a.hex)}><img src={x.logo} alt="" />{x.name}</button>;
              })}
            </div>
            {anchors.data && !anchors.data.length && <span className="hint">The street has no anchors open for listing on this network yet.</span>}
          </div>

          <div className="field">
            <div className="amount-head"><span>Seed</span>{supply > 0n && <span className="seg seg-sm">{SHARES.map((b) => <button key={String(b)} onClick={() => setText(String(Number((supply * b) / 10_000n) / 10 ** dec))}>{Number(b) / 100}%</button>)}</span>}</div>
            <div className="amount-input">
              <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label="Seed amount" placeholder={supply > 0n ? String(Number(min) / 10 ** dec) : ""} />
              <span className="amount-unit">{sym}</span>
            </div>
            <span className="hint">{supply > 0n ? <>{amt(min)} to {amt(max)}</> : "0.5% to 5% of the supply"}{publicKey && balance.data !== undefined ? <> · you hold {amt(balance.data)}</> : null}</span>
          </div>
          {seedProblem && <Notice tone="warn" title="Check the seed">{seedProblem}</Notice>}

          <div className="ticket-paper" role="group" aria-label="The listing">
            <div className="tp-row"><span>Locked in the house</span><i /><b className="mono">{seed ? amt(seed) : "…"}</b></div>
            {gross !== null && seed !== null && gross > seed && <div className="tp-row tp-small"><span>you send, with the transfer fee</span><i /><b className="mono">{amt(gross)}</b></div>}
            <div className="tp-row tp-small"><span>locked until</span><i /><b className="mono">a week from now</b></div>
            <div className="tp-row tp-small"><span>first round</span><i /><b className="mono">a day from now</b></div>
            <div className="tp-row tp-small"><span>listing fee</span><i /><b className="mono">{config.data ? `${(Number(config.data.listFeeLamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : "…"}</b></div>
          </div>
          <button className="primary" disabled={!ready || send.isPending} onClick={() => void list()}>
            {!publicKey ? "Connect a wallet" : send.isPending ? "Listing…" : `List ${sym ? `$${sym}` : "the coin"}${anchor ? ` on ${anchor.name}` : ""}`}
          </button>
        </section>
      )}
    </div>
  );
}

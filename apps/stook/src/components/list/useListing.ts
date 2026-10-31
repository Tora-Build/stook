// The list page's state in one place: the pasted mint, the anchor, the
// seed, what is wrong with each, and the listing transaction (`coin_list`).
import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { ataOf } from "../../lib/chain";
import { fmtCompact, parseAmount } from "../../lib/format";
import { coinByMint, coinPath } from "../../lib/coins";
import { LISTABLE, listedByMint, reloadListed } from "../../lib/listed";
import { useBalance, useMint, useSend } from "../../hooks/useChain";
import { logoOf, parseKey, symOf, useAnchorPrice, useAnchors, useCoinLook, useCoinUsd, useProtocolConfig } from "./data";

/** One-time rent for a listing's accounts, in SOL (house, series, vaults). */
export const RENT_SOL = 0.009;
/** What a house needs to be worth to start, and what lets callers bet properly. */
export const MIN_USD = 200;
export const GOOD_USD = 1000;

export type CoinProblem = { kind: "missing" | "refused" | "trusted" | "street" | "taken"; text: string } | null;

export function useListing() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [mintText, setMintText] = useState("");
  const mint = useMemo(() => parseKey(mintText), [mintText]);
  const [feed, setFeed] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [listed, setListed] = useState<{ symbol: string; anchor: string; at: bigint; path: string } | null>(null);

  const anchors = useAnchors();
  const config = useProtocolConfig();
  const mintQ = useMint(mint);
  const info = mintQ.data;
  const look = useCoinLook(mint);
  const balance = useBalance(mint, info?.tokenProgram);
  const sol = useQuery({ queryKey: ["balance", "sol", publicKey?.toBase58()], enabled: !!publicKey, refetchInterval: 20_000, queryFn: () => connection.getBalance(publicKey!) });
  const send = useSend("Listing");

  const chosen = feed ?? anchors.data?.[0]?.hex ?? null;
  const anchor = chosen ? LISTABLE[chosen] ?? null : null;
  const price = useAnchorPrice(chosen);
  const dec = info?.decimals ?? 0;
  const sym = symOf(look.data, mint);
  const logo = logoOf(look.data, sym);
  const supply = look.data?.supply ?? 0n;
  const [floor, max] = stook.seedBounds(supply);
  // A seed is judged in dollars when the coin has a price: $200 at least.
  // The program's own floor (0.01% of supply) only keeps out dust.
  const usd = useCoinUsd(mint).data ?? null;
  const unitsFor = (dollars: number) => (usd ? BigInt(Math.ceil((dollars / usd) * 10 ** dec)) : 0n);
  const min = usd && unitsFor(MIN_USD) > floor ? (unitsFor(MIN_USD) < max ? unitsFor(MIN_USD) : max) : floor;
  const seed = parseAmount(text, dec);
  const toUsd = (v: bigint | null) => (usd && v !== null ? (Number(v) / 10 ** dec) * usd : null);
  const seedUsd = toUsd(seed);
  const fee = info?.report.transferFee;
  const gross = seed ? stook.grossFor(seed, fee) : null;
  const series = mint && chosen ? stook.deriveSeries(Uint8Array.from(Buffer.from(chosen, "hex")), mint, 0) : null;
  const taken = useQuery({ queryKey: ["series-exists", series?.toBase58()], enabled: !!series, queryFn: async () => !!(await connection.getAccountInfo(series!)) });
  const street = mint ? coinByMint(mint) : undefined;
  const amt = (v: bigint) => `${fmtCompact(v, dec)} ${sym}`;
  const feeLamports = config.data ? Number(config.data.listFeeLamports) : null;
  const feeSol = feeLamports !== null ? `${(feeLamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : null;
  // What a lister needs in SOL all told: the listing fee read from chain plus the accounts' rent.
  const totalSol = feeLamports !== null ? `${(feeLamports / 1e9 + RENT_SOL).toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : null;

  const coinLoading = !!mint && (look.isLoading || mintQ.isLoading);
  const coinError = !!mint && (look.isError || mintQ.isError);
  const problem: CoinProblem =
    !mint || coinLoading || coinError ? null
    : !look.data || !info ? { kind: "missing", text: "No coin at that address on this network." }
    : info.report.verdict === "refused" ? { kind: "refused", text: `The street cannot hold this coin: ${info.report.reasons.join("; ")}.` }
    : info.report.verdict === "issuer-trusted" ? { kind: "trusted", text: `Its issuer keeps powers over holders (${info.report.reasons.join("; ")}). The street has to approve it first.` }
    : street && !("listing" in street) ? { kind: "street", text: `$${street.symbol} is already on the street.` }
    : taken.data ? { kind: "taken", text: `${sym || "This coin"} is already listed on ${anchor?.name}. Pick another asset.` }
    : null;
  const coinOk = !!mint && !!look.data && !!info && !problem && !coinLoading;
  const seedProblem = seed === null || !look.data ? null
    : seed < min ? (usd ? `The house needs at least $${MIN_USD}: ${amt(min)}.` : `The seed must be at least ${amt(min)}.`)
    : seed > max ? `The seed may be at most ${amt(max)}, 5% of the supply.`
    : balance.data !== undefined && gross !== null && balance.data < gross ? `Your wallet holds ${amt(balance.data)}.` : null;
  const seedOk = coinOk && seed !== null && seed > 0n && !seedProblem;
  const solOk = sol.data !== undefined && feeLamports !== null && sol.data >= feeLamports + RENT_SOL * 1e9;
  const ready = !!publicKey && coinOk && !!anchor && !!config.data && seedOk;

  async function list() {
    if (!ready || !publicKey || !mint || !info || !seed || !chosen || !config.data) return;
    const ix = stook.coinListIx({
      lister: publicKey, listerToken: ataOf(mint, publicKey, info.tokenProgram), feedId: Uint8Array.from(Buffer.from(chosen, "hex")), quoteMint: mint,
      tokenProgram: info.tokenProgram, treasury: config.data.treasury, seed, maxGross: stook.maxGrossFor(seed, [fee]),
    });
    await send.mutateAsync({ ixs: [ix], computeUnits: 250_000 });
    await reloadListed(connection);
    // The page's address is the symbol the listing store settled on (cleaned,
    // and suffixed when the name was taken), not the raw metadata symbol.
    const c = listedByMint(mint.toBase58());
    setListed({ symbol: c?.symbol ?? sym, anchor: anchor?.name ?? "", at: BigInt(Math.floor(Date.now() / 1000)) + stook.LIST_DELAY_SECS, path: c ? coinPath(c) : `/c/${sym.replace(/[^A-Z0-9]/g, "") || sym}` });
  }

  return {
    mintText, setMintText, mint, feed: chosen, setFeed, text, setText, listed, setListed,
    anchors, config, info, look, balance, sol, send, anchor, price: price.data ?? null,
    dec, sym, logo, supply, min, max, seed, usd, seedUsd, unitsFor, toUsd, fee, gross, amt, feeSol, totalSol, problem, seedProblem,
    coinLoading, coinError, coinOk, seedOk, solOk, ready, list, publicKey,
  };
}
export type Listing = ReturnType<typeof useListing>;

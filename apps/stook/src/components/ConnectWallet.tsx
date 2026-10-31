import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { COINS, mintOf } from "../lib/coins";
import { QUOTE_MINT } from "../lib/config";
import { useUsdRates } from "../lib/usd";
import { short } from "../lib/format";

const MOBILE = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/** Whole coins the wallet holds, by street coin symbol (and USDC on devnet). */
function useHeld(owner: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    // Under "balance", so a trade or the faucet refreshes it too.
    queryKey: ["balance", "wallet", owner?.toBase58()],
    enabled: !!owner,
    refetchInterval: 30_000,
    queryFn: async () => {
      const bySymbol = new Map<string, string>();
      for (const c of COINS) { const m = mintOf(c); if (m) bySymbol.set(m.toBase58(), c.symbol); }
      if (QUOTE_MINT) bySymbol.set(QUOTE_MINT.toBase58(), "USDC");
      const held: Record<string, number> = {};
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const r = await connection.getParsedTokenAccountsByOwner(owner!, { programId });
        for (const a of r.value) {
          const info = a.account.data.parsed?.info, sym = info && bySymbol.get(info.mint);
          if (sym) held[sym] = (held[sym] ?? 0) + Number(info.tokenAmount?.uiAmount ?? 0);
        }
      }
      return held;
    },
  });
}

/** The wallet's street coins in dollars, or null while any held coin has no price. */
function useWalletUsd(owner: PublicKey | null): number | null {
  const held = useHeld(owner), rates = useUsdRates();
  if (!held.data || !rates.data) return null;
  let sum = 0;
  for (const [sym, n] of Object.entries(held.data)) {
    if (!n) continue;
    const r = sym === "USDC" ? 1 : rates.data[sym];
    if (r === undefined) return null;
    sum += n * r;
  }
  return sum;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 1000 ? 2 : 0, maximumFractionDigits: n < 1000 ? 2 : 0 })}`;

// A phone browser such as Safari has no wallet in it: Phantom's app can't reach
// the page there. So with no wallet found on a phone, the button opens this page
// inside Phantom's own browser, where it connects as usual.
//
// `nav` is the header's button: yellow "Connect" while no wallet is connected,
// then a quiet pill with the wallet's dollars and its short address.
export function ConnectWallet({ children, nav = false }: { children?: ReactNode; nav?: boolean }) {
  const { wallets, connected, connecting, publicKey } = useWallet();
  const found = wallets.some((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const total = useWalletUsd(nav && connected ? publicKey : null);
  if (MOBILE && !found && !connected) {
    const href = `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
    return <a className={`wallet-adapter-button wallet-adapter-button-trigger ${nav ? "ss-wallet" : ""}`} href={href}>Open in Phantom</a>;
  }
  if (!nav) return <WalletMultiButton>{children}</WalletMultiButton>;
  const label = connected && publicKey
    ? <span className="ss-wallet-in"><i className="ss-dot" aria-hidden="true" />{total !== null && <b>{usd(total)}</b>}<span className="ss-addr">{short(publicKey)}</span></span>
    : connecting ? "Connecting" : "Connect";
  return <WalletMultiButton className={`ss-wallet ${connected ? "ss-wallet-on" : ""}`}>{label}</WalletMultiButton>;
}

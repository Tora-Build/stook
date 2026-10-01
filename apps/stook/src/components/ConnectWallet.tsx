import type { ReactNode } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const MOBILE = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// A phone browser such as Safari has no wallet in it: Phantom's app can't reach
// the page there. So with no wallet found on a phone, the button opens this page
// inside Phantom's own browser, where it connects as usual.
export function ConnectWallet({ children }: { children?: ReactNode }) {
  const { wallets, connected } = useWallet();
  const found = wallets.some((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  if (!MOBILE || found || connected) return <WalletMultiButton>{children}</WalletMultiButton>;
  const href = `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
  return <a className="wallet-adapter-button wallet-adapter-button-trigger" href={href}>Open in Phantom</a>;
}

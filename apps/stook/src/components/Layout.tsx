import { Link, NavLink, Outlet } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Faucet } from "./Faucet";
import { Skyline } from "./Skyline";
import { ThemeToggle } from "./Theme";
import { PageGuard } from "./PageGuard";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

export function Layout() {
  const location = useLocation();
  const home = location.pathname === "/";
  // A hash in the address scrolls to that section once the page has rendered it.
  useEffect(() => { if (!location.hash) return; const t = setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ block: "start" }), 150); return () => clearTimeout(t); }, [location]);
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand"><img src="/stook-coin.svg" alt="" width={30} height={30} /> STOOK STREET</Link>
        <nav>
          <NavLink to="/#floor" className={({ isActive }) => (isActive && location.hash === "#floor" ? "active" : "")}>Markets</NavLink>
          <NavLink to="/yours">Yours</NavLink>
          <NavLink to="/how">How it works</NavLink>
        </nav>
        <div className="top-right">
          <Faucet />
          <ThemeToggle />
          <WalletMultiButton />
        </div>
      </header>
      {!home && <Skyline />}
      <main className={home ? "main-street" : ""}><PageGuard key={location.pathname}><Outlet /></PageGuard></main>
      <footer className="foot">
        <span>Stook Street · devnet</span>
        <span className="foot-links">
          <a href="https://x.com/StookStreet" target="_blank" rel="noreferrer">X</a>
          <a href="https://t.me/StookStreet" target="_blank" rel="noreferrer">Telegram</a>
          <a href="https://github.com/Tora-Build/stook" target="_blank" rel="noreferrer">source</a>
        </span>
      </footer>
    </div>
  );
}

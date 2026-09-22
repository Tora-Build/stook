import { Link, NavLink, Outlet } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Faucet } from "./Faucet";
import { Skyline } from "./Skyline";
import { ThemeToggle } from "./Theme";
import { useLocation } from "react-router-dom";

export function Layout() {
  const home = useLocation().pathname === "/";
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand"><img src="/stook-coin.svg" alt="" width={30} height={30} /> STOOK STREET</Link>
        <nav>
          <NavLink to="/" end>Markets</NavLink>
          <NavLink to="/new">Create</NavLink>
          <NavLink to="/how">How it works</NavLink>
        </nav>
        <div className="top-right">
          <Faucet />
          <ThemeToggle />
          <WalletMultiButton />
        </div>
      </header>
      {!home && <Skyline />}
      <main className={home ? "main-street" : ""}><Outlet /></main>
      <footer className="foot">
        <span>Devnet · settled by Pyth · every number on this page is the program's own</span>
        <a href="https://github.com/Tora-Build/stook" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  );
}

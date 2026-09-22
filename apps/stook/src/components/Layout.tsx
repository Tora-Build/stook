import { Link, NavLink, Outlet } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Faucet } from "./Faucet";
import { Skyline } from "./Skyline";

export function Layout() {
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
          <WalletMultiButton />
        </div>
      </header>
      <Skyline />
      <main><Outlet /></main>
      <footer className="foot">
        <span>Devnet · settled by Pyth · every number on this page is the program's own · <a href="https://stooks.xyz">stooks.xyz</a></span>
        <a href="https://github.com/Tora-Build/stook" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  );
}

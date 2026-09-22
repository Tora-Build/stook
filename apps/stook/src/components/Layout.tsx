import { Link, NavLink, Outlet } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Faucet } from "./Faucet";

export function Layout() {
  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand"><img src="/stook.svg" alt="" width={22} height={22} /> Stook</Link>
        <nav>
          <NavLink to="/" end>Markets</NavLink>
          <NavLink to="/new">Create</NavLink>
        </nav>
        <div className="top-right">
          <Faucet />
          <WalletMultiButton />
        </div>
      </header>
      <main><Outlet /></main>
      <footer className="foot">
        <span>Devnet · settled by Pyth · every number on this page is the program's own</span>
        <a href="https://github.com/Tora-Build/stook" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  );
}

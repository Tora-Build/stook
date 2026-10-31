import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ConnectWallet } from "./ConnectWallet";
import { Faucet } from "./Faucet";
import { ThemeToggle } from "./Theme";
import { PageGuard } from "./PageGuard";
import { City } from "./City";
import { isDevnet } from "../lib/coins";

// Pages that draw their own hero (a City under the header). The rest get a
// short city band from the shell, so every page opens on the same picture.
const OWN_HERO = (path: string) => path === "/" || path === "/yours" || path === "/board" || path === "/list" || path.startsWith("/m/") || path.startsWith("/c/");

export function Layout() {
  const location = useLocation();
  const path = location.pathname;
  // A hash in the address scrolls to that section once the page has rendered it.
  useEffect(() => { if (!location.hash) return; const t = setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ block: "start" }), 150); return () => clearTimeout(t); }, [location]);
  const on = (yes: boolean) => ({ className: yes ? "on" : "" });
  return (
    <div className="app ss-app">
      <header className="ss-head">
        <Link to="/" className="ss-logo" aria-label="Stook Street home">
          <img src="/stook-coin.svg" alt="" width={36} height={36} />
          <span className="pix">STOOK ST.</span>
        </Link>
        <nav className="ss-links" aria-label="Main">
          <NavLink to="/" {...on(path === "/" || path.startsWith("/m/"))}>Play</NavLink>
          <NavLink to="/yours" {...on(path === "/yours")}>Yours</NavLink>
          <NavLink to="/c/STOOK" {...on(path.startsWith("/c/"))}>Earn</NavLink>
          <NavLink to="/board" {...on(path === "/board")}>Board</NavLink>
          <NavLink to="/list" {...on(path === "/list")}>List a coin</NavLink>
          <NavLink to="/how" className={path === "/how" ? "on ss-how-link" : "ss-how-link"}>How it works</NavLink>
        </nav>
        <div className="ss-right">
          <Link to="/how" className={`ss-pill ss-how ${path === "/how" ? "on" : ""}`}>How it works</Link>
          <Faucet />
          <ThemeToggle />
          <ConnectWallet nav />
        </div>
      </header>
      <main className="ss-main">
        {!OWN_HERO(path) && <City className="ss-band" fade="bottom" />}
        <PageGuard key={path}><Outlet /></PageGuard>
      </main>
      <footer className="ss-foot">
        <span className="ss-net"><i className="ss-dot" aria-hidden="true" />Stook Street · {isDevnet ? "devnet" : "mainnet"}</span>
        <span className="ss-foot-links">
          <a href="https://x.com/StookStreet" target="_blank" rel="noreferrer" aria-label="Stook Street on X (Twitter)">X</a>
          <a href="https://t.me/StookStreet" target="_blank" rel="noreferrer">Telegram</a>
          <a href="https://github.com/Tora-Build/stook" target="_blank" rel="noreferrer">Source</a>
        </span>
      </footer>
    </div>
  );
}

import "./lib/polyfills";
import React, { lazy, Suspense, useMemo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";
import { RPC_URL, WS_URL } from "./lib/config";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./components/Theme";
import { Layout } from "./components/Layout";
import { Markets } from "./pages/Markets";
// The street loads first; a round, a coin, the statement and the walk-through
// (the tower, the ticket, the trading SDK) load when they are opened.
const Market = lazy(() => import("./pages/Market").then((m) => ({ default: m.Market })));
const How = lazy(() => import("./pages/How").then((m) => ({ default: m.How })));
const Coin = lazy(() => import("./pages/Coin").then((m) => ({ default: m.Coin })));
const Yours = lazy(() => import("./pages/Yours").then((m) => ({ default: m.Yours })));
const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={<p className="page muted page-loading">Opening…</p>}>{children}</Suspense>;

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function App() {
  // Wallets register through Wallet Standard and are discovered; listing
  // adapters here only produces "already registered" warnings.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={qc}>
            <ThemeProvider>
            <ToastProvider>
              <BrowserRouter>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<Markets />} />
                    <Route path="/m/:id" element={<Page><Market /></Page>} />
                    <Route path="/how" element={<Page><How /></Page>} />
                    <Route path="/c/:symbol" element={<Page><Coin /></Page>} />
                    <Route path="/yours" element={<Page><Yours /></Page>} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </ToastProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

import "./lib/polyfills";
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";
import { RPC_URL } from "./lib/config";
import { ToastProvider } from "./components/Toast";
import { Layout } from "./components/Layout";
import { Markets } from "./pages/Markets";
import { Market } from "./pages/Market";
import { Create } from "./pages/Create";
import { How } from "./pages/How";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function App() {
  // Wallets register through Wallet Standard and are discovered; listing
  // adapters here only produces "already registered" warnings.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={qc}>
            <ToastProvider>
              <BrowserRouter>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<Markets />} />
                    <Route path="/m/:id" element={<Market />} />
                    <Route path="/new" element={<Create />} />
                    <Route path="/how" element={<How />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </ToastProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

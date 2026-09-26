import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// web3.js and the wallet adapter expect Buffer / process / global in the
// browser; `src/lib/polyfills.ts` sets them before anything else loads.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { buffer: "buffer/" } },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"), global: "globalThis" },
  optimizeDeps: { include: ["buffer"] },
  // The data routes live in the site's Worker; in dev, read the deployed ones.
  server: { port: 5180, strictPort: true, proxy: Object.fromEntries(["/prices", "/chart", "/usd", "/coins", "/pyth"].map((p) => [p, { target: "https://stookstreet.xyz", changeOrigin: true }])) },
});

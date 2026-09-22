// stooks.xyz: static assets, plus /prices — the four anchors' latest prices
// from Pyth's on-chain push accounts, read server-side (the public RPC
// refuses browser origins) and cached for a minute.
// Solana's own public RPC refuses Cloudflare's egress; a keyless public node
// serves it, or a provider URL set as the MAINNET_RPC secret takes over.
const FALLBACK_RPC = "https://solana-rpc.publicnode.com";
const ACCOUNTS = {
  "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14": "jf8MarLKgBte4f3NWufbNpGRCuBfJLhuZPuFigvSQR2",
  be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24: "HzdKMXqocYWqy7mh8AKDoZFJinjeGMfBKmGAxGbasc28",
  f68272be1240150c36b54dce26a9b75f62f507a94f49f43533a5050c77e07049: "EFQLA1wV7z55SM9scT4A5U5xpQbfRPBpRzN7M3q2gjo4",
  e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96: "FMGx9GMRAsAnFciE4HPHSMoWVZ6UgzmFJZ1nXdKVGH6e",
};
const hexBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/prices") return env.ASSETS.fetch(request);
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;
    const feeds = Object.keys(ACCOUNTS);
    const body = { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [Object.values(ACCOUNTS), { encoding: "base64" }] };
    const out = {};
    let j = {};
    try {
      const r = await fetch(env.MAINNET_RPC || FALLBACK_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      j = await r.json();
    } catch (e) { out.error = String(e).slice(0, 120); }
    (j.result?.value ?? []).forEach((a, i) => {
      if (!a) return;
      const d = Uint8Array.from(atob(a.data[0]), (c) => c.charCodeAt(0));
      const id = hexBytes(feeds[i]);
      let at = -1;
      for (let p = 0; p <= d.length - 32 && at < 0; p++) { let ok = true; for (let k = 0; k < 32; k++) if (d[p + k] !== id[k]) { ok = false; break; } if (ok) at = p; }
      if (at < 0) return;
      const dv = new DataView(d.buffer);
      out[feeds[i]] = { price: dv.getBigInt64(at + 32, true).toString(), expo: dv.getInt32(at + 48, true), publishTime: Number(dv.getBigInt64(at + 52, true)) };
    });
    const res = new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};

import { Connection, PublicKey } from "@solana/web3.js"; import { stook } from "@sooth/sdk-solana";
const c = new Connection("https://api.devnet.solana.com"); const k = new PublicKey("B6HEhU5u43WLuCEbrpBex8PseysDnDKUKLiBLM8Ncfgt");
for (let i = 0; i < 80; i++) { const l = stook.decodeLadder((await c.getAccountInfo(k)).data); if (l.status === "open") { console.log("open, b", l.b.toString(), "pool", l.depositTotal.toString()); process.exit(0); } await new Promise((r) => setTimeout(r, 30000)); }
console.log("not open yet");

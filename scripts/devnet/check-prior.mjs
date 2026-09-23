// Reads every seeding round on devnet and holds its opening odds and times to
// what the SDK predicts. Usage: node check-prior.mjs
import { Connection } from "@solana/web3.js";
import { stook, SOOTH_CORE_PROGRAM_ID } from "@sooth/sdk-solana";
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const rows = await c.getProgramAccounts(SOOTH_CORE_PROGRAM_ID, { filters: stook.ladderFilters("seeding") });
for (const { pubkey, account } of rows) {
  const l = stook.decodeLadder(account.data);
  const want = stook.prior(l.settlesAt - l.opensAt);
  const same = want.sum === l.curve.sum && want.w.every((w, i) => w === l.curve.w[i]);
  const gap = l.settlesAt - l.locksAt, window = l.settlesAt - l.opensAt;
  const centre = Number((l.curve.w[31] + l.curve.w[32]) * 10_000n / l.curve.sum) / 100;
  console.log(pubkey.toBase58().slice(0, 8), same ? "odds = SDK prior" : "ODDS DIFFER", `window ${window}s lock gap ${gap}s (${gap === (window / 24n < 120n ? 120n : window / 24n > 3600n ? 3600n : window / 24n) ? "ok" : "WRONG"})`, `centre bands ${centre}%`, `tier ${l.tier}`);
}

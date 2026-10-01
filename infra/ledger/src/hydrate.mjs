// Filling in what the events did not say. A round the ledger saw traded but
// never saw created, opened, settled or voided (a partial backfill, a log cut
// short) is read from its account, and its series from the series account,
// with the SDK's decoders. Only missing fields are written: what an event
// said always wins. A closed round has no account left; it stays as it is.

import { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";

const hex = (b) => Buffer.from(b).toString("hex");
const HOUR = 3600;

/** What a round still lacks, or null if nothing an account read could add. */
export function lacks(r, now) {
  if (!r) return null;
  if (r.closed) return null;
  if (!r.series || !r.settlesAt || !r.quoteMint || r.decimals == null) return "terms";
  if (!r.p0 && now >= (r.opensAt ?? r.settlesAt)) return "grid";
  if (!r.settled && !r.voided && now >= r.settlesAt + HOUR) return "outcome";
  return null;
}

/** The account's facts, as the events would have written them. */
export function fromLadder(l) {
  const out = {
    series: l.series.toBase58(), index: l.index,
    opensAt: Number(l.opensAt), locksAt: Number(l.locksAt), settlesAt: Number(l.settlesAt),
    creator: l.creator.toBase58(), quoteMint: l.quoteMint.toBase58(), decimals: l.decimals,
  };
  if (l.p0 > 0n) Object.assign(out, { p0: String(l.p0), expo: l.p0Expo, stepBps: l.stepBps });
  if (l.status === "settled" && l.settledBin !== null) out.settled = { price: null, expo: l.p0Expo, bin: l.settledBin, time: Number(l.settlesAt), sig: null };
  if (l.status === "void") out.voided = { time: null, sig: null };
  return out;
}

/** Facts that could only come from a ladder of today's layout. */
export const sane = (f) => f.settlesAt > 1_700_000_000 && f.settlesAt < 4_000_000_000 && f.opensAt <= f.settlesAt && f.decimals <= 18 && (!f.stepBps || f.stepBps <= 10_000);

const missingOnly = (have, got) => Object.fromEntries(Object.entries(got).filter(([k]) => have?.[k] === undefined || have?.[k] === null));

export async function hydrate({ store, rpc, programId, seen, now, batch = 100 }) {
  const want = [];
  for (const [ladder, r] of store.rounds()) {
    if (!lacks(r, now)) continue;
    if (now - (seen.get(ladder) ?? 0) < HOUR) continue;
    want.push(ladder);
  }
  let filled = 0;
  for (let i = 0; i < want.length; i += batch) {
    const keys = want.slice(i, i + batch);
    const res = await rpc.call("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
    res.value.forEach((a, n) => {
      const ladder = keys[n];
      seen.set(ladder, now);
      if (!a || a.owner !== programId) return;
      try {
        const data = Buffer.from(a.data[0], "base64");
        if (data.length !== stook.LADDER_SIZE) return;   // an account from an earlier layout
        const facts = fromLadder(stook.decodeLadder(data));
        if (!sane(facts)) return;
        const have = store.round(ladder);
        const add = missingOnly(have, facts);
        if (Object.keys(add).length) { store.apply({ rounds: { [ladder]: add } }); filled++; }
      } catch { /* not a ladder */ }
    });
  }
  // series the rounds name but no SeriesCreated event described
  const series = [...new Set(store.rounds().map(([, r]) => r.series).filter(Boolean))].filter((k) => !store.series(k)?.feedId && now - (seen.get(k) ?? 0) >= HOUR);
  for (let i = 0; i < series.length; i += batch) {
    const keys = series.slice(i, i + batch);
    const res = await rpc.call("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
    res.value.forEach((a, n) => {
      seen.set(keys[n], now);
      if (!a || a.owner !== programId) return;
      try {
        const s = stook.decodeSeries(Buffer.from(a.data[0], "base64"));
        store.apply({ series: { [keys[n]]: { feedId: hex(s.feedId), quoteMint: new PublicKey(s.quoteMint).toBase58(), periodSecs: s.periodSecs, closeSecs: s.closeSecs, clock: s.clock } } });
        filled++;
      } catch { /* not a series */ }
    });
  }
  return filled;
}

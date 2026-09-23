// A test series: a fixed period that lands a round exactly on the settlement
// second the recorded Pyth update needs, so tests keep their real prices.
import type { PublicKey } from "@solana/web3.js";
import * as L from "../../src/ladder/index";

export const PERIOD = 60;
/** Closes that teach a test series about 5% a day (±0.13% a minute),
 *  ending well before `before`: the warm-up a series needs to take rounds. */
export function warmCloses(indexOf: (at: bigint) => number, closeOf: (i: number) => bigint, before: bigint, p0: bigint) {
  const last = indexOf(before) - 80;
  const out: { index: number; at: bigint; price: bigint }[] = [];
  let p = p0;
  for (let i = last - L.WARMUP_OBSERVATIONS; i <= last; i++) {
    out.push({ index: i, at: closeOf(i), price: p });
    p = i % 2 ? (p * 10013n) / 10000n : (p * 10000n) / 10013n;
  }
  return out;
}

export function testSeries(feedId: Uint8Array, quoteMint: PublicKey, settlesAt: bigint, authority: PublicKey, programId: PublicKey) {
  const closeSecs = Number(settlesAt % BigInt(PERIOD));
  const series = L.deriveSeries(feedId, quoteMint, PERIOD, programId);
  const indexOf = (at: bigint) => Number((at - BigInt(closeSecs)) / BigInt(PERIOD));
  return {
    series,
    index: indexOf(settlesAt),
    indexOf,
    closeOf: (i: number) => BigInt(i) * BigInt(PERIOD) + BigInt(closeSecs),
    createIx: () => L.createSeriesIx({ authority, feedId, quoteMint, periodSecs: PERIOD, closeSecs, clock: L.CLOCK_UTC, programId }),
  };
}

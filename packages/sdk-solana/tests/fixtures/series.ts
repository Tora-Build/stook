// A test series: a fixed period that lands a round exactly on the settlement
// second the recorded Pyth update needs, so tests keep their real prices.
import type { PublicKey } from "@solana/web3.js";
import * as L from "../../src/ladder/index";

export const PERIOD = 60;
/** 5% a day: wide enough bands that the recorded update's confidence passes. */
export const TEST_VAR = L.varFromSigma(0.05);

export function testSeries(feedId: Uint8Array, quoteMint: PublicKey, settlesAt: bigint, authority: PublicKey, programId: PublicKey) {
  const closeSecs = Number(settlesAt % BigInt(PERIOD));
  const series = L.deriveSeries(feedId, quoteMint, PERIOD, programId);
  const indexOf = (at: bigint) => Number((at - BigInt(closeSecs)) / BigInt(PERIOD));
  return {
    series,
    index: indexOf(settlesAt),
    indexOf,
    createIx: () => L.createSeriesIx({ authority, feedId, quoteMint, periodSecs: PERIOD, closeSecs, clock: L.CLOCK_UTC, varWad: TEST_VAR, programId }),
  };
}

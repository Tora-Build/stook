// New York wall-clock instants, computed the same way in every viewer's
// timezone. A round's address is seeded by its settlement second, so two
// viewers who compute "4 PM New York on the 30th" differently start two
// different rounds for the same day.
import { stook } from "@sooth/sdk-solana";

const nyHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });

/** Unix seconds of `hour`:00 New York on New York calendar day (y, m0, d). */
export function nyAt(y: number, m0: number, d: number, hour: number): number {
  // Guess with New York's winter offset, then correct by what New York's
  // clock actually reads at the guess. Twice covers a guess that lands
  // across a daylight-saving change.
  let t = Date.UTC(y, m0, d, hour + 5, 0, 0);
  for (let k = 0; k < 2; k++) t += (hour - (Number(nyHour.format(new Date(t))) % 24)) * 3_600_000;
  return Math.floor(t / 1000);
}

/** New York's calendar date for an instant, as YYYY-MM-DD. */
export const nyDate = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** An instant on New York's clock; every round time is shown this way, the
 *  zone named once by the caller ("… New York"). */
export const nyWhen = (t: number | bigint, o: Intl.DateTimeFormatOptions) => new Date(Number(t) * 1000).toLocaleString("en-US", { ...o, timeZone: "America/New_York" });

/** The first day that can still open on a series part way through learning.
 *  A round opens only once its series has learned 20 returns, one per close
 *  after the last it learned, so a day whose lock comes before enough closes
 *  can only be refunded. A series with none yet can backfill from Pyth
 *  history, so nothing is ruled out there (null). */
export function firstOpenableDay(s: stook.SeriesAccount): number | null {
  if (s.observations === 0 || s.observations >= stook.WARMUP_OBSERVATIONS || s.periodSecs > 0) return null;
  let need = stook.WARMUP_OBSERVATIONS - s.observations, i = Math.floor(Number(s.lastAt) / stook.DAY) - 1;
  while (stook.closeOf(s, i) <= s.lastAt) i++;
  for (;; i++) if (stook.hasRound(s, i) && --need === 0) break;
  // Day i's close is the last one needed; it lands before the next round's lock.
  do i++; while (!stook.hasRound(s, i));
  return i;
}

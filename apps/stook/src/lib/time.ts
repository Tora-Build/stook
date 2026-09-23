// New York wall-clock instants, computed the same way in every viewer's
// timezone. A round's address is seeded by its settlement second, so two
// viewers who compute "4 PM New York on the 30th" differently start two
// different rounds for the same day.

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

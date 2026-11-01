// The coin and the anchor every scene names, in one place. $SSt. (STOOK St.)
// plays Polymarket (PreStocks), priced from its own pool; the tower's floors
// sit round the real last price (src/data/poly.json, from
// https://stookstreet.xyz/chart?coin=STOOK) and are `step` apart.
import POLY from "./data/poly.json";

const pts = POLY.points as [number, number][];
export const BRAND = {
  coin: "$SSt.",
  coinName: "STOOK St.",
  anchor: "POLYMARKET",
  anchorName: "Polymarket",
  logo: "logos/stook.png",
  anchorLogo: "logos/polymarket.png",
  points: pts,
  last: pts[pts.length - 1]![1],
  /** One floor of the tower: a 0.1% band (Polymarket moves little in a day). */
  step: 1.001,
  dp: 2,
  site: "stookstreet.xyz",
};
export const fmtPx = (v: number) => v.toFixed(BRAND.dp);

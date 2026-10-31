// The coin page's header: the pixel night city with the house's tower lit,
// and the one line that says what the page is for.
import { City } from "../City";
import type { Coin } from "../../lib/coins";

export function HouseHero({ coin, house }: { coin: Coin; house: boolean | null }) {
  return (
    <header className="house-hero">
      <City className="house-hero-city" fade="both" px={4} place={{ exchange: 0.86, bull: 0.58, cart: 0.95, sign: 0.5 }}
        tower={{ x: 0.7, w: 190, h: 236, floors: 8, band: house ? [2, 7] : null, sign: "THE HOUSE" }} />
      <div className="wrap house-hero-in">
        <div className="kicker taxi house-kick">EARN WITH ${coin.symbol}</div>
        <h1>Be the house</h1>
        <p className="house-hero-line">{house === false ? "Fund a day's round. Keep" : "Take the other side of every call. Keep"} <b>90% of the fees</b>.</p>
        <div className="house-coin">
          <span className="house-logos"><img src={coin.anchor.logo} alt="" /><img src={coin.logo} alt="" /></span>
          <b>{coin.anchor.name}</b><span className="dimmer">rounds in</span><b>${coin.symbol}</b>
        </div>
      </div>
    </header>
  );
}

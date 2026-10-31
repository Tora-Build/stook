// The coin's facts: the anchor's price, the coin's price, its transfer fee,
// and both mint addresses to check before trading.
import { Address } from "../Address";
import { anchorOf, isDevnet, mintOf, type Coin } from "../../lib/coins";
import { fmtUsd } from "../../lib/usd";

const Move = ({ v, dp }: { v: number | null | undefined; dp: number }) =>
  typeof v === "number" ? <em className={`num ${v >= 0 ? "up" : "down"}`}>{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(dp)}%</em> : null;

export function CoinFacts({ coin, anchorPrice, anchorChange, coinUsd, coinChange }: { coin: Coin; anchorPrice?: number; anchorChange?: number | null; coinUsd?: number; coinChange?: number | null }) {
  // On devnet the coin trades as a test twin of its mint; show the one in use.
  const live = mintOf(coin)?.toBase58() ?? coin.mint;
  const twin = isDevnet && !!live && live !== coin.mint;
  // On devnet a coin's rounds can settle on a stand-in feed; say which.
  const settle = anchorOf(coin);
  const standIn = settle.symbol !== coin.anchor.symbol;
  return (
    <section className="card house-cf" aria-label="The coin">
      <div className="house-cf-row">
        <span className="label">{coin.anchor.symbol} now</span>
        <span className="house-cf-v"><b className="num">{anchorPrice !== undefined ? `$${anchorPrice.toLocaleString("en-US", { minimumFractionDigits: coin.anchor.dp, maximumFractionDigits: coin.anchor.dp })}` : "…"}</b><Move v={anchorChange} dp={2} /></span>
      </div>
      <div className="house-cf-row">
        <span className="label house-cf-tick">${coin.symbol}</span>
        <span className="house-cf-v"><b className="num">{coinUsd ? fmtUsd(coinUsd) : "…"}</b><Move v={coinChange} dp={1} /></span>
      </div>
      {standIn && <div className="house-cf-row" title={`Devnet can't read the ${coin.anchor.symbol} feed yet.`}>
        <span className="label">Rounds settle on</span>
        <span className="house-cf-v"><b>{settle.symbol}</b><em className="dimmer">devnet</em></span>
      </div>}
      <div className="house-cf-row" title={coin.feeBps > 0 ? `$${coin.symbol} takes ${coin.feeBps / 100}% on every transfer. Every quote in the app includes it.` : undefined}>
        <span className="label">Transfer fee</span>
        <span className="house-cf-v"><b className="num">{coin.feeBps > 0 ? `${coin.feeBps / 100}%` : "None"}</b></span>
      </div>
      <div className="house-cf-addr">
        <Address label={`${coin.anchor.symbol} token`} value={coin.anchor.mint} />
        {live && <Address label={`$${coin.symbol}${twin ? " (devnet)" : ""}`} value={live} devnet={twin} />}
      </div>
    </section>
  );
}

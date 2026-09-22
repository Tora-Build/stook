// The whole mechanism in plain words, with the numbers a trader and an LP
// actually need. Everything here is a claim about the program; keep it true.

import { Link } from "react-router-dom";

const Fig = ({ levels, label }: { levels: number[]; label: string }) => (
  <figure className="fig">
    <svg viewBox="0 0 220 70" role="img" aria-label={label}>
      {levels.map((lv, i) => (
        <rect key={i} x={10 + i * 20} y={60 - lv * 12} width={18} height={lv * 12} className={lv ? "fig-on" : "fig-off"} rx={2} />
      ))}
      {levels.map((lv, i) => lv > 0 && <text key={"t" + i} x={19 + i * 20} y={57 - lv * 12} textAnchor="middle" className="fig-lbl">{lv}×</text>)}
    </svg>
    <figcaption>{label}</figcaption>
  </figure>
);

export function How() {
  return (
    <div className="page narrow how">
      <h1>How Stook works</h1>
      <p className="lede">A Stook market asks one question: <em>where will the price be at a fixed moment?</em> The answer is a range of 64 bands. You buy the bands you believe in; if the price lands there, you are paid.</p>

      <h2>The bands</h2>
      <p>When a market opens it reads the live price from Pyth and lays 64 bands around it — 32 below, 32 above. Each band is the same width in percent (1% on a standard market, 0.25% on a tight one). The two outer bands run to zero and to infinity, so every possible price lands somewhere.</p>
      <p>Each band has a price between 0 and 1: the market's current odds that the price lands there. The 64 odds always add up to exactly 1. Buying a band pushes its odds up and everyone else's down; that is the whole mechanism, and it means the chart is a live picture of what the crowd believes.</p>

      <h2>Line, range, reach</h2>
      <div className="figs">
        <Fig levels={[0, 0, 0, 1, 1, 1, 1, 1, 0, 0]} label="A range: pays 1× on every band inside it, nothing outside" />
        <Fig levels={[0, 0, 1, 2, 3, 4, 3, 2, 1, 0]} label="A line with reach 4: pays 4× at the band you picked, one less per band away" />
      </div>
      <p><strong>A range</strong> is a plain bet: pick a low and a high, and one share pays one token if the price lands anywhere between them. Wide range, high chance, low payout per share.</p>
      <p><strong>A line</strong> is a bet with a point of view. You pick the band you expect. One share pays <em>reach</em> tokens if the price lands exactly there, one token less for every band it misses by, and nothing beyond the reach. Reach 1 is a single band; reach 4 covers seven bands (three each side) and pays 4× at the centre.</p>
      <p><strong>What reach changes.</strong> A higher reach pays more at the centre and covers more bands — and costs more per share, because you are buying more payout. The price of a share is the sum of each band's odds times what that band pays you. So the market charges you exactly for the payout profile you drew, no more.</p>

      <h2>What you pay, what you win</h2>
      <p>Say the crowd gives each of seven bands around the current price about 5% odds. A range across those seven bands costs about 0.35 per share and pays 1 if the price lands inside — you roughly triple your money 35% of the time. A reach-4 line on the middle band costs about 0.80 per share (4×5% + 2×3×5% + 2×2×5% + 2×1×5%) and pays up to 4. Buy 100 shares and you have paid ~80; land on the centre and collect 400, one band off and collect 300, three off and collect 100.</p>
      <p>The quote in the trade panel is the exact number the program will charge, fee included. You can sell any time before the market locks, at the current odds — which is how you take profit early or cut a loss.</p>

      <h2>Providing liquidity</h2>
      <p>Somebody has to take the other side of every trade. In Stook that is a pool, and anyone can put money in it at any time before the market locks. Think of it as being the house.</p>
      <ul>
        <li><strong>You earn fees.</strong> Every trade pays a fee (1% on a standard market); 80% of it goes to the pool, split by how much depth each deposit provides, and only for trades made <em>after</em> you joined.</li>
        <li><strong>You lose when the crowd is right.</strong> The pool pays winners. If traders moved the odds toward where the price actually landed, the pool paid out more than it took in. If they moved the odds the wrong way, the pool keeps their money. Over many markets, an uninformed crowd is roughly break-even for the pool; a sharp crowd costs it.</li>
        <li><strong>Your worst case is your deposit.</strong> Your deposit buys exactly as much depth as it can cover alone, so the pool can never owe more than it holds. You cannot lose more than you put in, and nobody's loss is ever pushed onto another depositor.</li>
        <li><strong>Joining late is priced fairly.</strong> A deposit into a market that has already moved is valued from the odds at the moment it joined. It is not exposed to trades that happened before it, and it is not diluted by deposits after it.</li>
      </ul>
      <p>Depth is what a deposit buys. More depth means traders move the odds less per token, so the market can absorb bigger trades — and the pool earns fees on more volume before its odds move. A fresh market with 2,500 in deposits has depth about 600.</p>

      <h2>Settlement</h2>
      <p>Trading locks two minutes before the settlement time. At that time the program reads the Pyth price — specifically the first Pyth update at or after the settlement second, a rule that picks exactly one update, so nobody chooses the price. It lands in a band; that band pays; the pool's depositors collect what is left plus their fees. Anyone can trigger settlement and is paid a small bounty for it, so markets finish even if nobody is watching.</p>
      <p>If no usable price arrives within 24 hours (the feed went silent, or its confidence was wider than a band), the market is voided: every trader gets back exactly what they paid, fees included, and every depositor gets their deposit back.</p>

      <h2>Fees</h2>
      <p>Each market sets its own fee at creation, up to 5%. 80% goes to liquidity providers, 10% to the market's creator, 10% to the protocol — half of which is paid to whoever settles the market.</p>

      <p className="cta"><Link to="/">See the markets</Link> · <Link to="/new">Create one</Link></p>
    </div>
  );
}

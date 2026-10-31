// The home page: the featured round's question over the night city, then
// every street coin's table, the listed coins, the last bells, the street's
// own coin and the house.
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { coinBySymbol, coinPath, COINS, keyOf } from "../lib/coins";
import { useListed } from "../lib/listed";
import { useNow } from "../hooks/useNow";
import { Title } from "../components/Title";
import { Hero } from "../components/home/Hero";
import { HouseCard, LastBells, Listed, StreetCoin } from "../components/home/Sections";
import { FloorStage } from "../components/home/FloorStage";
import { featured, useStreetRounds, type StreetRound } from "../components/home/useStreet";
import { anchorOf, seriesOf } from "../lib/coins";

const STOOK = COINS.find((c) => keyOf(c) === "STOOK")!;
// Until the chain answers, the tables show each coin with no round state.
const BLANK: StreetRound[] = COINS.map((coin) => { const anchor = anchorOf(coin); return { coin, anchor, standIn: anchor.symbol !== coin.anchor.symbol, seriesKey: seriesOf(coin), series: null, index: null, closesAt: null, round: null, bells: [] }; });

export function Markets() {
  const [params] = useSearchParams();
  const { connection } = useConnection();
  const listedQ = useListed(connection);
  const listed = listedQ.coins.filter((c) => c.listing.state !== "rejected");
  const now = useNow();
  const rounds = useStreetRounds(now);
  const wanted = params.get("coin");
  const wantedCoin = wanted ? coinBySymbol(wanted) : undefined;
  if (wantedCoin) return <Navigate to={coinPath(wantedCoin)} replace />;

  const all = rounds.data ?? BLANK;
  const top = featured(rounds.data, now);
  return (
    <div className="home">
      <Title text="" />
      <Hero round={top} now={now} />
      <div className="wrap home-body">
        <FloorStage rounds={all} now={now} />

        <section>
          <div className="sec"><h2>Listed by their communities</h2><Link to="/list">List a coin <span aria-hidden="true">→</span></Link></div>
          <Listed coins={listed} ready={listedQ.ready} />
        </section>

        {top && <LastBells r={top} />}

        <section className="home-pair">
          <StreetCoin coin={STOOK} />
          <HouseCard />
        </section>
      </div>
    </div>
  );
}

// A coin's page is its house: the pixel city with the house's tower lit, the
// house's numbers, today's round and the anchor's last day, the calendar of
// rounds, and on the right the deposit box, your share and the coin's facts.
// A coin with a house gets one round a day from it. Without one, anyone can
// fund a day by hand and be that round's house.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { StartRound } from "../components/StartRound";
import { WallCalendar } from "../components/WallCalendar";
import { TodayDesk } from "../components/TodayDesk";
import { Notice } from "../components/Notice";
import { Title } from "../components/Title";
import { HouseHero } from "../components/house/HouseHero";
import { HouseBox, HouseStats } from "../components/house/HouseDesk";
import { CoinFacts } from "../components/house/CoinFacts";
import { Chart24 } from "../components/house/Chart24";
import { anchorOf, coinBySymbol, keyOf, mintOf, seriesOf, standInNote } from "../lib/coins";
import { quoteKeyOf, useListed, type ListedCoin } from "../lib/listed";
import { useSeries } from "../hooks/useChain";
import { useHouseRead } from "../hooks/useHouse";
import { useNow } from "../hooks/useNow";
import { firstOpenableDay, nyWhen } from "../lib/time";
import { useCoinQuotes } from "../lib/usd";

const DATA = "";
/** A slot can be started until this long before it settles: the program's
 *  fifteen minutes, plus time to sign and for the cluster clock to differ. */
const MIN_LEAD_SECS = 15 * 60 + 90;

export function Coin() {
  const { symbol } = useParams();
  const { connection } = useConnection();
  const listedReady = useListed(connection).ready;
  const coin = coinBySymbol(symbol ?? "");
  const listing = coin && "listing" in coin ? (coin as ListedCoin).listing : null;
  const qk = coin ? quoteKeyOf(coin) : "";
  const now = useNow();
  const [starting, setStarting] = useState<number | null>(null);
  const seriesKey = useMemo(() => (coin ? seriesOf(coin) : null), [coin]);
  const series = useSeries(seriesKey);
  // With a house, the house opens every day's round; without one, anyone can
  // fund a day. Until the read is back, neither: no by-hand buttons flash first.
  const houseRead = useHouseRead(seriesKey);
  const house = houseRead.data?.h ?? null;
  const houseKnown = !!seriesKey && houseRead.isSuccess;
  const houseErr = !!seriesKey && houseRead.isError && !houseRead.data;
  const byHand = houseKnown && !house;
  const hasHouse = houseKnown ? !!house : null;
  // A listed coin quoted under its own key has no anchor tape to chart.
  const chartOn = !!coin && (!listing || qk !== keyOf(coin));
  const chart = useQuery({ queryKey: ["chart", qk], queryFn: async () => (await fetch(`${DATA}/chart?coin=${qk}`)).json() as Promise<{ points: [number, number][] }>, enabled: chartOn, refetchInterval: 300_000 });
  const quote = useQuery({ queryKey: ["quote", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/prices`)).json() as Promise<Record<string, unknown>>, enabled: !!coin, refetchInterval: 60_000 });
  const cq = useCoinQuotes().data?.[coin?.symbol ?? ""];

  const anchor = coin ? anchorOf(coin) : null;
  if (!coin || !anchor) return <div className="wrap house-missing"><p className="dimmer">{listedReady ? "No such coin on the street." : "Opening…"}</p></div>;
  const q = quote.data?.[qk] as { price: number; change24h: number | null } | undefined;
  const mint = mintOf(coin);
  const firstOpen = series.data ? firstOpenableDay(series.data) : null;
  const canStart = byHand && !!mint && !!series.data?.active;
  // On devnet a coin's rounds may settle on a stand-in feed, not its anchor.
  const standIn = standInNote(coin);
  const chartNote = standIn ? `Rounds here settle on ${anchor.symbol}, not on this chart.` : null;
  const learning = series.data && firstOpen !== null && firstOpen > stook.indexAtOrBefore(series.data, BigInt(now)) + 1;

  return (
    <div className="house">
      <Title text={`$${coin.symbol} · ${coin.anchor.name}`} />
      <HouseHero coin={coin} house={hasHouse} settle={standIn ? anchor.name : null} />

      <div className="wrap house-body">
        {listing && <Notice className="house-notice" tone={listing.state === "rejected" ? "stop" : listing.state === "pending" ? "warn" : "info"} title={listing.state === "pending" ? "Listed, live soon" : listing.state === "rejected" ? "Turned down" : "Listed by its community"}>
          {listing.state === "pending" ? <>Listed by its community, not by the street. Rounds start {nyWhen(Number(listing.opensAfter), { weekday: "short", hour: "numeric", minute: "2-digit" })} NY. Anyone can list any coin: check the mint before you trade.</>
            : listing.state === "rejected" ? <>The street turned this listing down. No rounds. Whoever listed it can take their coins back.</>
            : <>Not by the street. Anyone can list any coin: check the mint before you trade.</>}
        </Notice>}

        <div className="house-grid">
          <div className="house-main">
            {house && seriesKey && mint && <HouseStats series={seriesKey} mint={mint} symbol={coin.symbol} />}

            {series.data && seriesKey
              ? <TodayDesk seriesKey={seriesKey} series={series.data} now={now} minLeadSecs={MIN_LEAD_SECS} dp={anchor.dp} coinSymbol={coin.symbol} anchorName={coin.anchor.name} canStart={canStart} onStart={setStarting} house={hasHouse} houseError={houseErr}
                  side={<Chart24 title={`${coin.anchor.symbol} · last 24 hours, NY`} note={chartNote} points={chart.data?.points ?? []} dp={coin.anchor.dp} state={!chartOn || chart.isError ? "none" : "loading"} />} />
              : <section className="card house-today house-today-solo"><Chart24 title={`${coin.anchor.symbol} · last 24 hours, NY`} note={chartNote} points={chart.data?.points ?? []} dp={coin.anchor.dp} state={!chartOn || chart.isError ? "none" : "loading"} /></section>}

            <section className="house-sec" id="calendar">
              <div className="house-sec-head">
                <h2>{byHand ? "Plan ahead" : "Calendar"}</h2>
                <span className="dimmer">{byHand ? "Fund any day up to 31 days out." : "One round a day, closing 4 PM NY."}</span>
              </div>
              {learning && <Notice className="house-notice" tone="info" title="New on the street">Rounds start {nyWhen(stook.closeOf(series.data!, firstOpen!), { weekday: "short", month: "short", day: "numeric" })}, after 20 daily closes ({series.data!.observations} so far).</Notice>}
              <div className="card house-cal-card">
                {series.data && seriesKey ? <WallCalendar seriesKey={seriesKey} series={series.data} now={now} minLeadSecs={MIN_LEAD_SECS} dp={anchor.dp} coinSymbol={coin.symbol} canStart={canStart} onStart={setStarting} house={hasHouse} />
                  : <p className="house-empty dimmer">{series.isLoading ? "Reading the calendar" : "This coin has no rounds on this network yet."}</p>}
              </div>
            </section>
          </div>

          <aside className="house-side">
            {house && seriesKey && mint ? <HouseBox series={seriesKey} mint={mint} symbol={coin.symbol} />
              : byHand ? <div className="card house-box house-hand">
                  <div className="label">No house yet</div>
                  <h3>Fund a day. Be its house.</h3>
                  <p className="dimmer">You take the other side of every call that day, and keep 90% of its fees.</p>
                  <a className="btn btn-block" href="#calendar">Pick a day</a>
                </div>
              : <div className="card house-box house-box-wait" aria-busy={!houseErr}><div className="label">The house</div><p className="dimmer">{!seriesKey ? "No rounds on this network yet" : houseErr ? "Can't read the house. Trying again." : "Reading the house"}</p></div>}
            <CoinFacts coin={coin} anchorPrice={q?.price} anchorChange={q?.change24h} coinUsd={cq?.usd} coinChange={cq?.change24h} />
          </aside>
        </div>
      </div>
      {starting !== null && byHand && series.data && seriesKey && <StartRound coin={coin} seriesKey={seriesKey} series={series.data} index={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

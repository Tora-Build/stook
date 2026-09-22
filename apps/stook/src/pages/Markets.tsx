import { Link, Navigate, useSearchParams } from "react-router-dom";
import { COINS } from "../lib/coins";
import { Skyline } from "../components/Skyline";
import { Floor } from "../components/Floor";

export function Markets() {
  const [params] = useSearchParams();
  const wanted = params.get("coin");
  if (wanted && COINS.some((c) => c.symbol === wanted.toUpperCase())) return <Navigate to={`/c/${wanted.toUpperCase()}`} replace />;
  return (
    <div className="street">
      <div className="hero-city">
        <Skyline hero />
        <div className="hero-copy">
          <h1>Where will it land?</h1>
          <p className="lede">Memecoins anchored to stocks. Your coin follows a stock; here you draw a line where that stock will land, in your coin, and get paid by how close you were.</p>
          <p className="lede-links"><a href="#floor">Walk onto the floor</a> · <Link to="/how">How it works</Link></p>
        </div>
      </div>
      <div id="floor"><Floor /></div>
    </div>
  );
}

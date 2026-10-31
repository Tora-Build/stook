// The list page's header: the live street with one new tower whose sign
// says YOUR COIN. Until a coin is pasted below it stands shuttered, under
// scaffolding; then the shutter rolls up, its floors burn gold, the sign
// takes the coin's ticker and the coin's logo sits on the roof.
import { useEffect, useState } from "react";
import { stook } from "@sooth/sdk-solana";
import { City, type CityLayout } from "../City";

const DAY = 86_400n;
// The street's sign lettering (public/city.js) has no J, Q or Z, and its "$" reads as an S.
const SIGNABLE = /^[A-IK-PR-Y0-9 .%+-]{1,9}$/;

/** On a phone the copy fills the hero, so the new tower would stand behind the headline. */
function usePhone() {
  const q = "(max-width: 640px)";
  const [on, setOn] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return on;
}

export function ListHero({ logo, sym, apply }: { logo: string | null; sym: string; apply: boolean }) {
  const [lay, setLay] = useState<CityLayout | null>(null);
  const phone = usePhone();
  const lit = !!logo;
  const tag = lit && sym ? `$${sym.toUpperCase()}` : "";
  const plate = sym.toUpperCase();
  const sign = lit && SIGNABLE.test(plate) ? plate : "YOUR COIN";
  const lockDays = Number(stook.LIST_LOCK_SECS / DAY), delayDays = Number(stook.LIST_DELAY_SECS / DAY);
  const go = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const T = lay?.tower;
  return (
    <section className={`list-hero ${lit ? "lit" : ""}`}>
      <City className="list-hero-city" fade="left" px={4} place={{ exchange: 0.88, bull: 0.5, cart: 0.97, sign: 0.44 }}
        tower={phone ? null : { x: 0.64, w: 170, h: 380, floors: 12, band: lit ? [2, 11] : null, sign }} onLayout={setLay}>
        {T && !phone && (
          <>
            {/* The shutter: the floors under the sign stay dark until a coin is pasted. */}
            <div className="list-hero-shutter" aria-hidden="true"
              style={{ left: T.left - 2, width: T.width + 4, top: T.floorTop(2), height: T.top + T.height - T.floorTop(2) }}>
              <span className="list-hero-soon pix">SOON</span>
            </div>
            <div className="list-hero-roof" aria-hidden="true" style={{ left: T.left + T.width / 2, top: T.top - 5 * lay!.scale }}>
              {logo ? <img key={logo} src={logo} alt="" /> : <span className="list-hero-plus pix">+</span>}
              {tag && <span className="list-hero-tag">{tag}</span>}
            </div>
          </>
        )}
      </City>
      <div className="wrap list-hero-in">
        <div className="kicker taxi list-kick">LIST A COIN</div>
        <h1 className="list-h1">Put your coin<br />to <em>work</em></h1>
        <p className="list-hero-line">Holders get a daily round paid in the coin. The house earns <b>90% of the fees</b>.</p>
        <div className="list-hero-ctas">
          <a className="btn" href="#list-desk" onClick={go("list-desk")}>{apply ? "Apply to list" : "List your coin"} <span aria-hidden="true">→</span></a>
          <a className="btn btn-ghost" href="#list-needs" onClick={go("list-needs")}>What you need</a>
        </div>
        <dl className="list-hero-facts">
          <div><dt>first round</dt><dd className="pix">{delayDays} DAY</dd></div>
          <div><dt>seed locked</dt><dd className="pix">{lockDays} DAYS</dd></div>
          <div><dt>house keeps</dt><dd className="pix">90%</dd></div>
        </dl>
      </div>
    </section>
  );
}

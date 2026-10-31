// A trader from the floor, seen from the front: the same suits, skins and
// hair as public/floor-life.js, picked from the wallet so a caller keeps one
// look. A medal on the chest for the podium; the winner throws both arms up.
import { seed } from "./data";

const SUITS = ["#1b2a47", "#3b2a22", "#7d2f22", "#2f4d7c", "#3a3f4c", "#4a3b6b"];
const SKINS = ["#f1c9a5", "#d9a173", "#a86f45", "#6b4a2e", "#c68642"];
const HAIRS = ["#0b1120", "#5a3a1a", "#c9bfa4", "#a8412f", "#8a8f99"];
export const MEDALS = { 1: ["#ffc629", "#fff1b8"], 2: ["#c9d2e3", "#ffffff"], 3: ["#d9824a", "#ffc8a0"] } as const;

export function Trader({ wallet, place, size = 6, className = "" }: { wallet: string; place?: 1 | 2 | 3; size?: number; className?: string }) {
  const n = seed(wallet);
  const suit = SUITS[n % SUITS.length]!, skin = SKINS[(n >>> 4) % SKINS.length]!, hair = HAIRS[(n >>> 8) % HAIRS.length]!;
  const up = place === 1;
  const medal = place ? MEDALS[place] : null;
  return (
    <svg className={`board-trader ${className}`} width={16 * size} height={23 * size} viewBox="0 0 16 23" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="3" y="22" width="10" height="1" fill="rgba(0,0,0,.35)" />
      {/* hair and head */}
      <rect x="4" y="0" width="8" height="2" fill={hair} /><rect x="3" y="1" width="10" height="2" fill={hair} />
      <rect x="4" y="2" width="8" height="6" fill={skin} />
      <rect x="3" y="2" width="1" height="3" fill={hair} /><rect x="12" y="2" width="1" height="3" fill={hair} />
      <rect x="6" y="4" width="1" height="1" fill="#0b1120" /><rect x="9" y="4" width="1" height="1" fill="#0b1120" />
      {up ? <><rect x="6" y="6" width="4" height="1" fill="#7a3b2a" /><rect x="7" y="7" width="2" height="1" fill="#7a3b2a" /></> : <rect x="7" y="6" width="2" height="1" fill="#7a3b2a" />}
      <rect x="7" y="8" width="2" height="1" fill={skin} />
      {/* suit, shirt, tie */}
      <rect x="3" y="9" width="10" height="9" fill={suit} />
      <rect x="6" y="9" width="4" height="2" fill="#f5eedb" /><rect x="7" y="11" width="2" height="3" fill="#f5eedb" />
      <rect x="7" y="10" width="2" height="5" fill={medal ? medal[0] : "#c23b2f"} />
      {/* arms */}
      {up ? <>
        <rect x="1" y="3" width="2" height="8" fill={suit} /><rect x="13" y="3" width="2" height="8" fill={suit} />
        <rect x="1" y="1" width="2" height="2" fill={skin} /><rect x="13" y="1" width="2" height="2" fill={skin} />
      </> : <>
        <rect x="1" y="10" width="2" height="7" fill={suit} /><rect x="13" y="10" width="2" height="7" fill={suit} />
        <rect x="1" y="17" width="2" height="1" fill={skin} /><rect x="13" y="17" width="2" height="1" fill={skin} />
        <rect x="14" y="14" width="2" height="3" fill="#f4e9c8" />
      </>}
      {/* the medal on its ribbon */}
      {medal && <>
        <rect x="4" y="9" width="1" height="3" fill="#3b6bff" /><rect x="5" y="9" width="1" height="3" fill="#ff6b5e" />
        <rect x="4" y="12" width="3" height="3" fill={medal[0]} /><rect x="4" y="12" width="1" height="1" fill={medal[1]} />
      </>}
      {/* legs and shoes */}
      <rect x="4" y="18" width="3" height="3" fill="#0e1424" /><rect x="9" y="18" width="3" height="3" fill="#0e1424" />
      <rect x="3" y="21" width="4" height="1" fill="#05080f" /><rect x="9" y="21" width="4" height="1" fill="#05080f" />
    </svg>
  );
}

/** An empty spot on the podium: a dashed outline of a trader. */
export function GhostTrader({ size = 6 }: { size?: number }) {
  return (
    <svg className="board-trader board-ghost" width={16 * size} height={23 * size} viewBox="0 0 16 23" shapeRendering="crispEdges" aria-hidden="true">
      <g fill="currentColor">
        <rect x="4" y="0" width="8" height="1" /><rect x="3" y="1" width="1" height="7" /><rect x="12" y="1" width="1" height="7" /><rect x="4" y="8" width="8" height="1" />
        <rect x="3" y="9" width="10" height="1" /><rect x="3" y="10" width="1" height="11" /><rect x="12" y="10" width="1" height="11" /><rect x="3" y="21" width="10" height="1" />
        <rect x="7" y="3" width="2" height="1" /><rect x="8" y="4" width="1" height="1" /><rect x="7" y="5" width="1" height="1" /><rect x="7" y="7" width="1" height="1" />
      </g>
    </svg>
  );
}

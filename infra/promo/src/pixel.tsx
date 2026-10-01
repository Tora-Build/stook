// Pixel art from the tower (apps/stook/src/components/Tower.tsx), as crisp SVG at any whole scale.
export const BELL = ["....aa....", "...abba...", "..abccba..", "..abccbb..", ".abcccbba.", ".abccbbba.", ".abcbbbba.", "abcbbbbbba", "aaaaaaaaaa", "....dd....", "....dd...."];
export const BELLPAL = { a: "#b47416", b: "#f0a83a", c: "#ffe28a", d: "#f4e9c8" };
export const TAXI = ["...aaaaaaa......", "..abbbabbba.....", "aaaaaaaaaaaaaaa.", "aacaaaaaaaaaaaac", "aaaaaaaaaaaaaaaa", ".dd.......dd....", ".dd.......dd...."];
export const TAXIPAL = { a: "#f0a83a", b: "#1f3050", c: "#f4e9c8", d: "#0b1120" };
export const FLAG = Array.from({ length: 15 }, (_, y) => Array.from({ length: 10 }, (_, x) => (x === 0 ? "p" : y >= 1 && y <= 4 ? ((x + y) % 2 ? "k" : "w") : ".")).join(""));
export const FLAGPAL = { p: "#c9bfa4", k: "#0b1120", w: "#f4e9c8" };
// a stack of coins, one coin per row pair: rim, face, shine
export const COIN = ["aaaaaaaaaa", ".bbbbbbbb.", "cccccccccc"];
export const COINPAL = { a: "#8a5a12", b: "#ffe28a", c: "#f0a83a" };

export function Pixel(p: { map: string[]; pal: Record<string, string>; s: number; style?: React.CSSProperties }) {
  const w = p.map[0]!.length, h = p.map.length;
  return (
    <svg width={w * p.s} height={h * p.s} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ display: "block", ...p.style }}>
      {p.map.flatMap((row, y) => [...row].map((ch, x) => (p.pal[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={p.pal[ch]} /> : null)))}
    </svg>
  );
}

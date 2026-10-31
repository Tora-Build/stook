// The list page's pixel art, drawn from character maps: one letter is one
// pixel, "." is empty. Crisp at any size (shapeRendering crispEdges).
import type { CSSProperties } from "react";

type Pal = Record<string, string>;

export function Pix({ rows, pal, size, className, style }: { rows: string[]; pal: Pal; size: number; className?: string; style?: CSSProperties }) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === "." || !pal[c]) { x++; continue; }
      let n = 1; while (row[x + n] === c) n++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={n} height={1} fill={pal[c]} />);
      x += n;
    }
  });
  return (
    <svg className={className} style={style} width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">{rects}</svg>
  );
}

const GOLD = { y: "#ffc629", d: "#c88a14", l: "#fff4c4" };

/** A desk calendar with a bell on it: a round every day. */
export const DailyArt = ({ size = 112 }: { size?: number }) => (
  <Pix size={size} pal={{ ...GOLD, c: "#f5eedb", r: "#ff6b5e", s: "#c9bfa3", k: "#101a2e", g: "#3ddc84", n: "#22314f" }} rows={[
    "....................",
    "...nn.......nn......",
    "..rrrrrrrrrrrrrrr...",
    "..rnnrrrrrrrrnnrr...",
    "..ccccccccccccccc...",
    "..ccccccccccccccc...",
    "..ccckkcckkcckkcc...",
    "..ccccccccccccccc...",
    "..ccckkcckkcckkcc...",
    "..ccccccccccccccc...",
    "..ccckkcckkccyycc......y",
    "..cccccccccccyy......yyy.",
    "..ccckkcckkc........yyyyy",
    "..cccccccccc.......yylyyy",
    "..sssssssss........yylyyy",
    "..................yyyyyyyy",
    "....................ddd.",
    ".....................y..",
  ]} />
);

/** The house: a vault with coins stacked at its door. */
export const VaultArt = ({ size = 112 }: { size?: number }) => (
  <Pix size={size} pal={{ ...GOLD, c: "#f5eedb", g: "#127a4a", G: "#3ddc84", D: "#0d5c38", k: "#0a1020", b: "#1d2d50" }} rows={[
    "........cccccc........",
    "........cggggc........",
    "..cccccccccccccccccc..",
    "...GGGGGGGGGGGGGGGG...",
    "...gDggDgggggggDggDg..",
    "...gDggDgkkkkkgDggDg..",
    "...gDggDgkbbbkgDggDg..",
    "...gDggDgkbbbkgDggDg..",
    "...gDggDgkbbykgDggDg..",
    "...gDggDgkbbbkgDggDg..",
    "...gDggDgkbbbkgDggDg..",
    "yyygggggggkbbbkggggyyy",
    "dddkkkkkkkkkkkkkkkkddd",
    "yyy................yyy",
  ]} />
);

/** A table on the floor from above: a round screen, traders at the rim. */
export const TableArt = ({ size = 112 }: { size?: number }) => (
  <Pix size={size} pal={{ ...GOLD, n: "#2a3758", s: "#16203a", e: "#5ef0a0", a: "#e0b48a", h: "#3a2a1a", u: "#3b6bff", r: "#c0392b", t: "#6b4a2a" }} rows={[
    "........ah......ah......",
    "........uu......rr......",
    "..ah......nnnnnn........",
    "..uu....nnssssssnn....ah",
    "......nnssssssssssnn..uu",
    ".....nssssssyyssssssn...",
    ".....nssssssyyssssssn...",
    "....nsssssssssssssssn...",
    "ah..nsssseeeeeeesssssn..",
    "rr..nsssseeeeeeesssssn..",
    "....nsssssssssssssssn...",
    ".....nsssssssssssssn....",
    ".....nssssssssssssn...ah",
    "......nnssssssssnn....tt",
    "..ah....nnssssnn........",
    "..tt......nnnn......ah..",
    "........ah..........uu..",
    "........uu..............",
  ]} />
);

/** A pixel tick in a box: done. An empty box: not yet. */
export const Tick = ({ on, size = 24 }: { on: boolean; size?: number }) => (
  <Pix size={size} pal={{ b: on ? "#3ddc84" : "#2c3d61", f: on ? "rgba(61,220,132,.16)" : "transparent", k: "#3ddc84" }} rows={on ? [
    "bbbbbbbbbbbb",
    "bffffffffffb",
    "bffffffffkfb",
    "bfffffffkkfb",
    "bffffffkkffb",
    "bfkfffkkfffb",
    "bfkkfkkffffb",
    "bffkkkfffffb",
    "bfffkffffffb",
    "bffffffffffb",
    "bffffffffffb",
    "bbbbbbbbbbbb",
  ] : [
    "bbbbbbbbbbbb", "b..........b", "b..........b", "b..........b", "b..........b", "b..........b",
    "b..........b", "b..........b", "b..........b", "b..........b", "b..........b", "bbbbbbbbbbbb",
  ]} />
);

/** An empty lot: a fence, a crane, a sign. Where a coin's tower will go. */
export const LotArt = ({ size = 200 }: { size?: number }) => (
  <Pix size={size} pal={{ ...GOLD, k: "#101a2e", g: "#4a5568", f: "#8a6a3a", c: "#f5eedb", w: "#62d0ff" }} rows={[
    "..........yyyyyyyyyyyyyyyyyyy...",
    "..........y.yy.y..............k.",
    "..........yy..yy..............k.",
    "..........y.yy.y..............k.",
    "..........yy..yy.............kkk",
    "..........y.yy.y.............kkk",
    "..........yy..yy................",
    "..........y.yy.y................",
    "..........yy..yy.....cccccccc...",
    "..........y.yy.y.....cwwcwwcc...",
    "..........yy..yy.....cccccccc...",
    "..........y.yy.y.........k......",
    "..........yy..yy.........k......",
    "..f.f.f.f.f.f.f.f.f.f.f.f.f.f.f.",
    "ffffffffffffffffffffffffffffffff",
    "..f.f.f.f.f.f.f.f.f.f.f.f.f.f.f.",
    "gggggggggggggggggggggggggggggggg",
  ]} />
);

/** A speech slip, as the traders on the floor use. */
export const TalkArt = ({ size = 56 }: { size?: number }) => (
  <Pix size={size} pal={{ c: "#f5eedb", k: "#101a2e", y: "#ffc629" }} rows={[
    "..cccccccccccc..",
    ".cccccccccccccc.",
    "cccccccccccccccc",
    "cckkcckkkkcckkcc",
    "cccccccccccccccc",
    "cckkkkkcckkkkkcc",
    "cccccccccccccccc",
    ".cccccccccccccc.",
    "..cccccccccccc..",
    "....ccc.........",
    "....cc......y...",
    "....c......yyy..",
    "............y...",
  ]} />
);

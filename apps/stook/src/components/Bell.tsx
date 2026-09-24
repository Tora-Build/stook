// The closing bell, in pixels: a brass bell with a crown loop, a round dome,
// a flared lip and a clapper, outlined so it reads on any ground. It swings
// while the round is being settled and rests after.

type Row = [y: number, from: number, to: number];

// The bell's silhouette on a 20 by 20 grid, row by row.
const BODY: Row[] = [
  [3, 8, 11], [4, 6, 13], [5, 5, 14], [6, 5, 14], [7, 4, 15], [8, 4, 15], [9, 4, 15],
  [10, 4, 15], [11, 4, 15], [12, 3, 16], [13, 2, 17], [14, 1, 18], [15, 1, 18],
];
const LOOP: Row[] = [[0, 9, 10], [1, 8, 8], [1, 11, 11], [2, 9, 10]];
const SHADE: Row[] = [[5, 12, 14], [6, 12, 14], [7, 13, 15], [8, 13, 15], [9, 13, 15], [10, 13, 15], [11, 13, 15], [12, 14, 16], [13, 15, 17]];
const SHINE: Row[] = [[4, 7, 8], [5, 6, 7], [6, 6, 6], [7, 5, 5], [8, 5, 5], [9, 5, 5]];
const LIP: Row[] = [[15, 1, 18]];
const CLAPPER: Row[] = [[16, 9, 10], [17, 8, 11], [18, 9, 10]];

// A one-pixel dark outline: every filled row, widened by one and drawn on
// the rows above and below too, under the fill.
const outline = (rows: Row[]): Row[] => rows.flatMap(([y, a, b]) => [[y - 1, a - 1, b + 1], [y, a - 1, b + 1], [y + 1, a - 1, b + 1]] as Row[]);

export function Bell({ ringing = false, rung = false, size = 26 }: { ringing?: boolean; rung?: boolean; size?: number }) {
  const px = (rows: Row[], fill: string, tag: string) =>
    rows.map(([y, a, b], k) => <rect key={`${tag}${k}`} x={a} y={y} width={b - a + 1} height={1} fill={fill} />);
  return (
    <svg className={`bell ${ringing ? "bell-ringing" : ""} ${rung ? "bell-rung" : ""}`} viewBox="-1 -1 22 22" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <g className="bell-body">
        {px(outline([...LOOP, ...BODY, ...CLAPPER]), "#2a1606", "o")}
        {px(LOOP, "#b47416", "l")}
        {px(BODY, "#f0a83a", "b")}
        {px(SHADE, "#c97f1c", "s")}
        {px(SHINE, "#fff1c4", "h")}
        {px(LIP, "#9a5c10", "p")}
        {px(CLAPPER, "#5a2a14", "c")}
      </g>
    </svg>
  );
}

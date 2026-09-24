// The closing bell, in pixels: a brass bell with a crown loop, a round dome,
// a flared lip and a clapper, outlined so it reads on any ground. Drawn on a
// 14 by 14 grid and shown at a whole number of screen pixels per cell, so the
// pixels stay square and sharp. It swings while the round is being settled.

type Row = [y: number, from: number, to: number];

const LOOP: Row[] = [[0, 6, 7], [1, 5, 5], [1, 8, 8]];
const BODY: Row[] = [[2, 5, 8], [3, 4, 9], [4, 3, 10], [5, 3, 10], [6, 3, 10], [7, 3, 10], [8, 2, 11], [9, 1, 12], [10, 0, 13]];
const SHADE: Row[] = [[3, 8, 9], [4, 9, 10], [5, 9, 10], [6, 9, 10], [7, 9, 10], [8, 10, 11], [9, 11, 12]];
const SHINE: Row[] = [[3, 5, 5], [4, 4, 4], [5, 4, 4], [6, 4, 4]];
const LIP: Row[] = [[10, 0, 13]];
const CLAPPER: Row[] = [[11, 6, 7], [12, 6, 7]];

// A one-cell dark outline under the fill: each row widened by one, drawn on
// its own line and the lines above and below.
const outline = (rows: Row[]): Row[] => rows.flatMap(([y, a, b]) => [[y - 1, a - 1, b + 1], [y, a - 1, b + 1], [y + 1, a - 1, b + 1]] as Row[]);

/** `scale` screen pixels per cell: 2 gives a 32 px bell. */
export function Bell({ ringing = false, rung = false, scale = 2 }: { ringing?: boolean; rung?: boolean; scale?: number }) {
  const px = (rows: Row[], fill: string, tag: string) =>
    rows.map(([y, a, b], k) => <rect key={`${tag}${k}`} x={a} y={y} width={b - a + 1} height={1} fill={fill} />);
  return (
    <svg className={`bell ${ringing ? "bell-ringing" : ""} ${rung ? "bell-rung" : ""}`} viewBox="-1 -1 16 16" width={16 * scale} height={16 * scale} shapeRendering="crispEdges" aria-hidden="true">
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

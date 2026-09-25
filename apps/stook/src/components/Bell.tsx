// The closing bell, in pixels: the classic school bell. A knob, a full round
// dome that reaches its width fast, straight sides, a wide flared lip and a
// clapper ball, outlined so it reads on any ground. Drawn on a 16 by 16 grid
// and shown at a whole number of screen pixels per cell, so the pixels stay
// square and sharp. It swings while the round is being settled.

type Row = [y: number, from: number, to: number];

const LOOP: Row[] = [[0, 7, 8]];
const BODY: Row[] = [[1, 5, 10], [2, 4, 11], [3, 3, 12], [4, 3, 12], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 2, 13], [10, 2, 13], [11, 1, 14], [12, 0, 15]];
const SHADE: Row[] = [[2, 10, 11], [3, 11, 12], [4, 11, 12], [5, 11, 12], [6, 11, 12], [7, 11, 12], [8, 11, 12], [9, 12, 13], [10, 12, 13], [11, 13, 14]];
const SHINE: Row[] = [[2, 5, 6], [3, 4, 5], [4, 4, 4], [5, 4, 4], [6, 4, 4], [7, 4, 4]];
const LIP: Row[] = [[12, 0, 15]];
const CLAPPER: Row[] = [[13, 6, 9], [14, 7, 8]];

// A one-cell dark outline under the fill: each row widened by one, drawn on
// its own line and the lines above and below.
const outline = (rows: Row[]): Row[] => rows.flatMap(([y, a, b]) => [[y - 1, a - 1, b + 1], [y, a - 1, b + 1], [y + 1, a - 1, b + 1]] as Row[]);

/** `scale` screen pixels per cell: 2 gives a 36 px bell. */
export function Bell({ ringing = false, rung = false, scale = 2 }: { ringing?: boolean; rung?: boolean; scale?: number }) {
  const px = (rows: Row[], fill: string, tag: string) =>
    rows.map(([y, a, b], k) => <rect key={`${tag}${k}`} x={a} y={y} width={b - a + 1} height={1} fill={fill} />);
  return (
    <svg className={`bell ${ringing ? "bell-ringing" : ""} ${rung ? "bell-rung" : ""}`} viewBox="-1 -1 18 17" width={18 * scale} height={17 * scale} shapeRendering="crispEdges" aria-hidden="true">
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

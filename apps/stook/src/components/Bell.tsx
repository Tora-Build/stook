// The closing bell, in pixels: a brass bell with its crown, shoulder, lip and
// clapper. It swings while the round is being settled and rests after.

// Each row: [y, x from, x to] on a 14 by 14 grid.
const BODY: [number, number, number][] = [
  [1, 6, 7], [2, 5, 8], [3, 6, 7],            // crown loop
  [4, 5, 8], [5, 4, 9], [6, 4, 9], [7, 3, 10], [8, 3, 10], [9, 3, 10],
  [10, 2, 11], [11, 1, 12],                   // flared lip
];
const SHADE: [number, number, number][] = [[5, 8, 9], [6, 8, 9], [7, 9, 10], [8, 9, 10], [9, 9, 10], [10, 10, 11], [11, 11, 12]];
const SHINE: [number, number, number][] = [[5, 5, 5], [6, 5, 5], [7, 4, 4], [8, 4, 4]];

export function Bell({ ringing = false, rung = false, size = 16 }: { ringing?: boolean; rung?: boolean; size?: number }) {
  const px = (rows: [number, number, number][], fill: string) =>
    rows.map(([y, a, b]) => <rect key={`${fill}${y}${a}`} x={a} y={y} width={b - a + 1} height={1} fill={fill} />);
  return (
    <svg className={`bell ${ringing ? "bell-ringing" : ""} ${rung ? "bell-rung" : ""}`} viewBox="0 0 14 14" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <g className="bell-body">
        {px(BODY, "#f0a83a")}
        {px(SHADE, "#b47416")}
        {px(SHINE, "#fbe3a6")}
        <rect x={6} y={12} width={2} height={2} fill="#7d2f22" />{/* clapper */}
      </g>
    </svg>
  );
}

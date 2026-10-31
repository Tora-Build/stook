// Small pixel pictures for the desk: crisp squares, the street's colours.

/** A trader's desk at night: lamp on, a screen with the tape, tickets, coins.
 *  `lit` turns the screen's tape and the lamp on (an empty desk waits dark). */
export function PixelDesk({ lit = true, className }: { lit?: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 72" shapeRendering="crispEdges" aria-hidden="true">
      {/* floor shadow */}
      <rect x="8" y="68" width="104" height="4" fill="#060b16" />
      {/* the desk */}
      <rect x="10" y="44" width="100" height="4" fill="#7a4a24" /><rect x="10" y="44" width="100" height="1" fill="#a86a36" />
      <rect x="12" y="48" width="96" height="2" fill="#4e2e16" />
      <rect x="14" y="50" width="4" height="18" fill="#4e2e16" /><rect x="102" y="50" width="4" height="18" fill="#4e2e16" />
      <rect x="70" y="50" width="30" height="14" fill="#5d3719" /><rect x="72" y="52" width="26" height="4" fill="#4e2e16" /><rect x="83" y="53" width="4" height="2" fill="#ffc629" />
      <rect x="72" y="58" width="26" height="4" fill="#4e2e16" /><rect x="83" y="59" width="4" height="2" fill="#ffc629" />
      {/* the screen with the tape */}
      <rect x="18" y="16" width="38" height="26" fill="#1d2742" /><rect x="20" y="18" width="34" height="20" fill="#040a07" />
      <rect x="34" y="42" width="6" height="2" fill="#1d2742" />
      {lit ? <g fill="#5ef0a0">
        {[[22, 32], [25, 30], [28, 31], [31, 27], [34, 28], [37, 24], [40, 25], [43, 22], [46, 23], [49, 20]].map(([x, y]) => <rect key={x} x={x} y={y} width="3" height="2" />)}
        <rect x="22" y="35" width="12" height="1" opacity=".5" /><rect x="38" y="35" width="8" height="1" opacity=".5" />
      </g> : <rect x="22" y="27" width="30" height="1" fill="#173826" />}
      {/* the lamp */}
      <rect x="92" y="40" width="10" height="4" fill="#2c3d61" /><rect x="96" y="22" width="2" height="18" fill="#2c3d61" />
      <rect x="84" y="18" width="16" height="4" fill="#2c3d61" /><rect x="82" y="22" width="10" height="4" fill={lit ? "#ffc629" : "#22314f"} />
      {lit && <rect x="80" y="26" width="14" height="2" fill="#fff4c4" opacity=".6" />}
      {/* the tickets */}
      <rect x="60" y="38" width="18" height="6" fill="#f5eedb" /><rect x="62" y="36" width="18" height="6" fill="#e7dcbf" /><rect x="64" y="34" width="18" height="6" fill="#f5eedb" />
      <rect x="66" y="36" width="10" height="1" fill="#a9b4cc" /><rect x="66" y="38" width="6" height="1" fill="#a9b4cc" /><rect x="76" y="37" width="4" height="2" fill="#3ddc84" />
      {/* the coins */}
      <g className="yours-art-coins">{[0, 1, 2, 3].map((n) => <g key={n}><rect x="40" y={42 - n * 2} width="10" height="2" fill={n % 2 ? "#c88a14" : "#ffc629"} /></g>)}
        <rect x="40" y="34" width="10" height="2" fill="#fff4c4" /></g>
    </svg>
  );
}

/** The bell that ends a round. */
export function PixelBell({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <g fill="#ffc629"><rect x="7" y="0" width="2" height="2" /><rect x="5" y="2" width="6" height="2" /><rect x="4" y="4" width="8" height="6" /><rect x="2" y="10" width="12" height="2" /></g>
      <rect x="7" y="13" width="2" height="2" fill="#f5eedb" /><rect x="5" y="5" width="1" height="4" fill="#fff4c4" />
    </svg>
  );
}

/** Two stacks of gold coins, for money ready to take. */
export function PixelCoins({ size = 40 }: { size?: number }) {
  const coin = (x: number, y: number, k: number) => (
    <g key={`${x}-${k}`}>
      <rect x={x + 1} y={y} width="8" height="1" fill="#fff4c4" />
      <rect x={x} y={y + 1} width="10" height="2" fill="#ffc629" />
      <rect x={x + 1} y={y + 3} width="8" height="1" fill="#b8870f" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="1" y="22" width="22" height="2" fill="#0a1020" opacity=".45" />
      {[0, 1, 2, 3].map((k) => coin(2, 18 - k * 3, k))}
      {[0, 1, 2, 3, 4, 5].map((k) => coin(12, 18 - k * 3, k))}
      <rect x="15" y="3" width="4" height="1" fill="#b8870f" />
    </svg>
  );
}

/** The house: a vault with coins at its door. */
export function PixelVault({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 44" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="4" y="40" width="56" height="4" fill="#0a1020" />
      <rect x="8" y="14" width="48" height="26" fill="#127a4a" /><rect x="8" y="14" width="48" height="2" fill="#3ddc84" />
      <rect x="6" y="10" width="52" height="4" fill="#f5eedb" /><rect x="24" y="2" width="16" height="8" fill="#f5eedb" /><rect x="26" y="4" width="12" height="4" fill="#127a4a" />
      <g fill="#0d5c38">{[12, 20, 40, 48].map((x) => <rect key={x} x={x} y="18" width="4" height="20" />)}</g>
      <rect x="27" y="22" width="10" height="18" fill="#0a1020" /><rect x="29" y="24" width="6" height="16" fill="#1d2d50" /><rect x="33" y="31" width="1" height="2" fill="#ffc629" />
      <g className="yours-art-coins">{[[4, 34], [10, 36], [52, 34], [58, 36]].map(([x, y]) => <g key={x}><rect x={x! - 3} y={y} width="6" height="2" fill="#ffc629" /><rect x={x! - 3} y={y! - 2} width="6" height="2" fill="#c88a14" /><rect x={x! - 3} y={y! - 4} width="6" height="2" fill="#ffc629" /></g>)}</g>
    </svg>
  );
}

/** A floor plan of a call: three lit floors and a marker. */
export function PixelCall({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="2" width="12" height="2" fill="#62d0ff" /><rect x="2" y="7" width="12" height="2" fill="#ffc629" /><rect x="2" y="12" width="12" height="2" fill="#62d0ff" /><rect x="0" y="6" width="2" height="4" fill="#ffc629" />
    </svg>
  );
}

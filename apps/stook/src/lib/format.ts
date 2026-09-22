export const fmtAmount = (units: bigint, decimals: number, dp = 2): string => {
  const neg = units < 0n; const u = neg ? -units : units;
  const s = u.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals, s.length - decimals + dp);
  const w = Number(whole).toLocaleString("en-US");
  return (neg ? "−" : "") + (dp > 0 ? `${w}.${frac}` : w);
};

export const parseAmount = (text: string, decimals: number): bigint | null => {
  const m = text.trim().replace(/,/g, "").match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt((m[1] || "0") + frac);
};

export const fmtPrice = (raw: bigint | number, expo: number, dp: number): string =>
  (Number(raw) * 10 ** expo).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const pct = (wad: bigint, dp = 1): string => (Number(wad) / 1e16).toFixed(dp) + "%";

export const fmtWhen = (t: bigint): string =>
  new Date(Number(t) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const untilText = (t: bigint, now: number): string => {
  const s = Number(t) - now;
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
};

export const short = (k: { toBase58(): string }) => { const s = k.toBase58(); return `${s.slice(0, 4)}…${s.slice(-4)}`; };

export const fmtAmount = (units: bigint, decimals: number, dp = 2): string => {
  const neg = units < 0n; const u = neg ? -units : units;
  const s = u.toString().padStart(decimals + 1, "0");
  // Never show a real amount as 0.00: widen to its first two significant digits.
  if (u > 0n && dp > 0 && u < 10n ** BigInt(Math.max(decimals - dp, 0))) {
    const frac = s.slice(s.length - decimals), first = frac.search(/[1-9]/);
    dp = Math.min(decimals, first + 2);
  }
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

/** A probability (WAD) the way a person reads it: "12.5%", or "1 in 10,900" when it is under 0.1%. */
export const chance = (wad: bigint): string => {
  const p = Number(wad) / 1e18;
  if (p >= 0.001) return `${(p * 100).toFixed(1)}%`;
  if (p <= 0) return "0%";
  const n = 1 / p, mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return `1 in ${(Math.round(n / mag) * mag).toLocaleString("en-US")}`;
};

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

/** A coin amount short enough for a cell: 16.12M, 281.6K, 950.25. */
export const fmtCompact = (units: bigint, decimals: number): string => {
  const v = Number(units) / 10 ** decimals, a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "B";
  if (a >= 1e6) return (v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  if (a >= 1e4) return (v / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return fmtAmount(units, decimals);
};

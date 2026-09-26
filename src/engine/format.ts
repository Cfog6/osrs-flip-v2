/** 1.23m, 950k, 1.2b */
export function gp(n: number): string {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${Math.round(a).toLocaleString()}`;
}

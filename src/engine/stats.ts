/**
 * History-based probabilities, measured on hourly /timeseries data (~15 days).
 *
 * Everything is RELATIVE to the price level at each historical start hour, so the question
 * asked of history is: "if I had bid d% below the market and then asked m% above my buy
 * price, how often would that have worked within the time I actually have?"
 *
 * Conventions (deliberately conservative):
 *  - A buy "fills" only if a later hour's AVERAGE instant-sell price reached the bid.
 *  - A sell "exits" only if a later hour's AVERAGE instant-buy price reached the target.
 *  - Windows that run past the end of the data are skipped, not counted as failures.
 */
import type { SeriesPoint } from "./types";

export interface Dense {
  t0: number;                 // unix seconds of index 0
  low: (number | null)[];     // avg instant-sell price per hour
  high: (number | null)[];    // avg instant-buy price per hour
  lowVol: number[];
  highVol: number[];
}

/** Hourly series with missing hours filled as null prices / zero volume. */
export function densify(points: SeriesPoint[]): Dense {
  const pts = [...points].sort((a, b) => a.timestamp - b.timestamp);
  if (pts.length === 0) return { t0: 0, low: [], high: [], lowVol: [], highVol: [] };
  const t0 = pts[0].timestamp;
  const n = Math.round((pts[pts.length - 1].timestamp - t0) / 3600) + 1;
  const d: Dense = { t0, low: Array(n).fill(null), high: Array(n).fill(null), lowVol: Array(n).fill(0), highVol: Array(n).fill(0) };
  for (const p of pts) {
    const i = Math.round((p.timestamp - t0) / 3600);
    d.low[i] = p.avgLowPrice ?? null;
    d.high[i] = p.avgHighPrice ?? null;
    d.lowVol[i] = p.lowPriceVolume ?? 0;
    d.highVol[i] = p.highPriceVolume ?? 0;
  }
  return d;
}

export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

const lastN = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
const nonNull = (a: (number | null)[]) => a.filter((x): x is number => x != null);

/** Least-squares trend of log mid-price over the last `hours`, as % per day. */
export function trendPctPerDay(d: Dense, hours: number): number {
  const lo = lastN(d.low, hours), hi = lastN(d.high, hours);
  const xs: number[] = [], ys: number[] = [];
  lo.forEach((l, i) => {
    const h = hi[i];
    if (l != null && h != null) { xs.push(i); ys.push(Math.log((l + h) / 2)); }
  });
  if (xs.length < 24) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  const slopePerHour = den === 0 ? 0 : num / den;
  return (Math.exp(slopePerHour * 24) - 1) * 100;
}

export function recentHighPercentile(d: Dense, hours: number, p: number): number | null {
  return percentile(nonNull(lastN(d.high, hours)), p);
}

export function volumeLastHours(d: Dense, hours: number): { low: number; high: number } {
  return {
    low: lastN(d.lowVol, hours).reduce((a, b) => a + b, 0),
    high: lastN(d.highVol, hours).reduce((a, b) => a + b, 0),
  };
}

export function hoursOfHistory(d: Dense): number {
  return d.low.filter((x, i) => x != null || d.high[i] != null).length;
}

export interface FlipOdds {
  pFill: number;
  nFill: number;               // start hours observed for the full gap
  pExit: number;
  nExit: number;               // fills observed for the full hold (or that exited)
  medianHoursToExit: number | null;
  avgLossRel: number;          // mean relative P&L (after tax) of fills that never exited, marked at the horizon
}

/**
 * @param gapH   hours the buy offer sits before the player checks again
 * @param d      bid discount below the start-hour price (0.01 = 1% below)
 * @param m      required markup of sell target over the buy price (S/bid - 1)
 * @param holdH  max hold after the fill (72h)
 * @param taxRate effective tax on the exit (0.02, or 0 for exempt items)
 */
export function flipOdds(dn: Dense, gapH: number, d: number, m: number, holdH: number, taxRate: number): FlipOdds {
  const n = dn.low.length;
  const G = Math.max(1, Math.round(gapH));
  let starts = 0, fills = 0, exitObs = 0, exits = 0;
  const exitHours: number[] = [];
  const losses: number[] = [];

  for (let i = 0; i + G <= n - 1; i++) {
    const ref = dn.low[i];
    if (ref == null) continue;
    starts++;
    const bid = ref * (1 - d);
    let j = -1;
    for (let k = i + 1; k <= i + G; k++) {
      const l = dn.low[k];
      if (l != null && l <= bid) { j = k; break; }
    }
    if (j < 0) continue;
    fills++;
    const target = bid * (1 + m);
    let exitedAt = -1;
    for (let k = j + 1; k <= Math.min(j + holdH, n - 1); k++) {
      const h = dn.high[k];
      if (h != null && h >= target) { exitedAt = k; break; }
    }
    if (exitedAt >= 0) {
      exitObs++; exits++; exitHours.push(exitedAt - j);
    } else if (j + holdH <= n - 1) {
      exitObs++;
      // marked at the horizon: sell at the instant-sell price then (last known), after tax
      let mark: number | null = null;
      for (let k = j + holdH; k >= j && mark == null; k--) mark = dn.low[k];
      if (mark != null) losses.push((mark * (1 - taxRate) - bid) / bid);
    } // else censored: not enough future data, skip
  }

  return {
    pFill: starts ? fills / starts : 0,
    nFill: starts,
    pExit: exitObs ? exits / exitObs : 0,
    nExit: exitObs,
    medianHoursToExit: median(exitHours),
    avgLossRel: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : -0.03,
  };
}

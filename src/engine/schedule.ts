/**
 * Play-window logic in the player's local timezone, with no date library.
 * Works by stepping in 5-minute increments, which is exact for windows that start on
 * :00/:05/.../:55 and handles daylight-saving changes for free.
 */
import type { Config } from "./types";

const STEP = 5 * 60_000;
const HOUR = 3_600_000;
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type ScheduleConfig = Pick<Config, "timezone" | "playWindows" | "maxUnattendedCheckHours" | "digestLeadMinutes">;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Local weekday (0=Sun) and minutes since local midnight. */
export function localTime(ms: number, tz: string): { dow: number; minutes: number } {
  const parts = fmt(tz).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour")) % 24;
  return { dow: DOW[get("weekday")] ?? 0, minutes: hour * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function windowsFor(dow: number, cfg: ScheduleConfig): [number, number][] {
  const list = dow === 0 || dow === 6 ? cfg.playWindows.weekend : cfg.playWindows.weekday;
  return list.map(([s, e]) => [toMinutes(s), toMinutes(e)] as [number, number]);
}

export function inWindow(ms: number, cfg: ScheduleConfig): boolean {
  const { dow, minutes } = localTime(ms, cfg.timezone);
  return windowsFor(dow, cfg).some(([s, e]) => minutes >= s && minutes < e);
}

const ceilStep = (ms: number) => Math.ceil(ms / STEP) * STEP;

/** First moment >= ms at which a play window starts. */
export function nextWindowStart(ms: number, cfg: ScheduleConfig): number {
  let t = ceilStep(ms);
  const limit = t + 8 * 24 * HOUR;
  for (; t < limit; t += STEP) if (inWindow(t, cfg) && !inWindow(t - STEP, cfg)) return t;
  throw new Error("No play window found in the next 8 days; check config.playWindows");
}

/** First moment > ms that is outside the window containing ms. */
export function windowEnd(ms: number, cfg: ScheduleConfig): number {
  let t = ceilStep(ms + 1);
  while (inWindow(t, cfg)) t += STEP;
  return t;
}

/** Start of the window containing ms. */
export function windowStart(ms: number, cfg: ScheduleConfig): number {
  let t = Math.floor(ms / STEP) * STEP;
  while (inWindow(t - STEP, cfg)) t -= STEP;
  return t;
}

export interface Placement {
  placementAt: number; // when offers are placed: now if in a window, else next window start
  nextCheckAt: number; // when the player next looks
  gapHours: number;    // how long an offer placed at placementAt sits unattended
  inWindow: boolean;
}

/**
 * The gap an offer must survive. Inside a long window (weekends) the player checks every
 * maxUnattendedCheckHours; otherwise the offer sits until the next session starts.
 */
export function placement(now: number, cfg: ScheduleConfig): Placement {
  const nowIn = inWindow(now, cfg);
  const T = nowIn ? now : nextWindowStart(now, cfg);
  const start = windowStart(T, cfg);
  const end = windowEnd(T, cfg);
  const maxU = cfg.maxUnattendedCheckHours * HOUR;
  // Check-ins sit on a fixed grid (window start + k * maxU) so they don't drift run to run.
  let next = nextWindowStart(end, cfg);
  for (let c = start + maxU; c < end; c += maxU) {
    if (c >= T + HOUR) { next = c; break; }
  }
  return { placementAt: T, nextCheckAt: next, gapHours: (next - T) / HOUR, inWindow: nowIn };
}

/** Check-in times: every window start, plus every maxUnattendedCheckHours inside long windows. */
export function checkInTimesBetween(from: number, to: number, cfg: ScheduleConfig): number[] {
  const out: number[] = [];
  const maxU = cfg.maxUnattendedCheckHours * HOUR;
  for (let t = ceilStep(from); t <= to; t += STEP) {
    if (!inWindow(t, cfg)) continue;
    const since = t - windowStart(t, cfg);
    if (since === 0 || since % maxU === 0) out.push(t);
  }
  return out;
}

/** The digest that should be sent now, if any: lead minutes before a check-in, with slack for cron delays. */
export function dueDigest(now: number, cfg: ScheduleConfig, slackMinutes = 45): number | null {
  const lead = cfg.digestLeadMinutes * 60_000;
  const slack = slackMinutes * 60_000;
  const checks = checkInTimesBetween(now + lead - slack, now + lead, cfg);
  for (const c of checks) {
    const d = c - lead;
    if (now >= d && now < d + slack) return c;
  }
  return null;
}

/** Local "Tue 16:00" label. */
export function localLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

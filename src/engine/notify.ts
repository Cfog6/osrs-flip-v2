/** Builds push messages and decides when to send them. Sending is done by the engine script. */
import type { Config, PlanFile, Recommendation } from "./types";
import { dueDigest, inWindow, localLabel } from "./schedule";
import { gp } from "./format";

export interface NotifyState {
  digestsSent: number[];                 // check-in times (ms) a digest was sent for
  strongAlerted: Record<string, number>; // recId -> ms alerted
}

export const emptyNotifyState = (): NotifyState => ({ digestsSent: [], strongAlerted: {} });

const line = (r: Recommendation) =>
  `**${r.name}**: buy ${r.qty.toLocaleString()} @ ${gp(r.bid)}, sell @ ${gp(r.sell)} → +${gp(r.predProfit)} if it works ` +
  `(fill ${Math.round(r.pFill * 100)}%, exit ${Math.round(r.pExit * 100)}%)${r.strong ? " ⭐" : ""}`;

export function digestMessage(plan: PlanFile, cfg: Config, checkIn: number, pageUrl: string): string {
  const g = plan.gear.slice(0, cfg.slots.gear), q = plan.quick.slice(0, cfg.slots.quick);
  const parts = [
    `**Session plan for ${localLabel(checkIn, cfg.timezone)}**: offers placed then sit ~${Math.round(plan.gapHours)}h (next check ${localLabel(plan.nextCheckAt, cfg.timezone)}).`,
    g.length ? `__Gear__\n${g.map(line).join("\n")}` : "__Gear__\n(nothing passes the filters right now)",
    q.length ? `__Quick__\n${q.map(line).join("\n")}` : "__Quick__\n(nothing passes the filters right now)",
    pageUrl,
  ];
  return parts.join("\n\n").slice(0, 1990);
}

export function strongMessage(r: Recommendation, cfg: Config, pageUrl: string): string {
  return `⭐ **Strong buy** (${r.type}): ${line(r)}. Check back ${localLabel(r.checkBackAt, cfg.timezone)}.\n${pageUrl}`.slice(0, 1990);
}

/** What should be sent now, plus the updated state. Pure. */
export function decideNotifications(plan: PlanFile, cfg: Config, state: NotifyState, nowMs: number, pageUrl: string): { messages: string[]; state: NotifyState } {
  const messages: string[] = [];
  const next: NotifyState = {
    digestsSent: state.digestsSent.filter((t) => nowMs - t < 3 * 86_400_000),
    strongAlerted: Object.fromEntries(Object.entries(state.strongAlerted).filter(([, t]) => nowMs - t < 3 * 86_400_000)),
  };

  const checkIn = dueDigest(nowMs, cfg);
  if (checkIn != null && !next.digestsSent.includes(checkIn)) {
    messages.push(digestMessage(plan, cfg, checkIn, pageUrl));
    next.digestsSent.push(checkIn);
  }

  const lead = cfg.digestLeadMinutes * 60_000;
  const awake = inWindow(nowMs, cfg) || inWindow(nowMs + lead, cfg);
  if (awake) {
    const top = [...plan.gear.slice(0, cfg.slots.gear), ...plan.quick.slice(0, cfg.slots.quick)];
    for (const r of top) {
      if (r.strong && !next.strongAlerted[r.recId]) {
        messages.push(strongMessage(r, cfg, pageUrl));
        next.strongAlerted[r.recId] = nowMs;
      }
    }
  }
  return { messages, state: next };
}

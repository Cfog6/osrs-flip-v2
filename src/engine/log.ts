/**
 * Append-only recommendation log (data/recs.jsonl).
 * A recommendation is logged BEFORE the player can see it. If a later run produces an
 * essentially identical recommendation, the already-logged version is shown instead, so what
 * the player sees always matches a logged prediction exactly.
 */
import type { Config, Recommendation } from "./types";

type Draft = Omit<Recommendation, "recId" | "ts">;
const key = (r: { type: string; itemId: number }) => `${r.type}:${r.itemId}`;

export function parseLog(text: string): Recommendation[] {
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Recommendation);
}

export function lastByKey(log: Recommendation[]): Map<string, Recommendation> {
  const m = new Map<string, Recommendation>();
  for (const r of log) m.set(key(r), r);
  return m;
}

function materiallyChanged(prev: Recommendation, next: Draft, nowMs: number, cfg: Config["log"]): boolean {
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
  return (
    rel(next.bid, prev.bid) > cfg.materialChangePct ||
    rel(next.sell, prev.sell) > cfg.materialChangePct ||
    rel(next.qty, prev.qty) > cfg.qtyChangePct ||
    prev.checkBackAt !== next.checkBackAt ||
    nowMs - prev.ts > cfg.refreshHours * 3_600_000
  );
}

/** Returns the recs to show (logged versions) and the new lines to append. */
export function reconcile(drafts: Draft[], prevLog: Recommendation[], nowMs: number, cfg: Config["log"]): { shown: Recommendation[]; appended: Recommendation[] } {
  const last = lastByKey(prevLog);
  const shown: Recommendation[] = [];
  const appended: Recommendation[] = [];
  for (const d of drafts) {
    const prev = last.get(key(d));
    if (prev && !materiallyChanged(prev, d, nowMs, cfg)) {
      shown.push(prev);
    } else {
      const rec: Recommendation = { recId: `${d.itemId}-${nowMs}`, ts: nowMs, ...d };
      appended.push(rec);
      shown.push(rec);
    }
  }
  return { shown, appended };
}

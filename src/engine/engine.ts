/** One engine run: data in, plan + new log lines out. No file or network I/O here. */
import type { Config, PlanFile, Recommendation } from "./types";
import type { WikiClient } from "./wiki";
import { buildExemptIds } from "./tax";
import { placement } from "./schedule";
import { evaluate, prefilter } from "./recommend";
import { densify } from "./stats";
import { reconcile } from "./log";

export async function runEngine(wiki: WikiClient, cfg: Config, prevLog: Recommendation[], nowMs: number, log: (s: string) => void = () => {}) {
  const [mapping, latest, hourly] = await Promise.all([wiki.mapping(), wiki.latest(), wiki.hourly()]);
  const exempt = buildExemptIds(mapping);
  const place = placement(nowMs, cfg);
  const candidates = prefilter(mapping, latest, hourly, exempt, cfg, nowMs, place.gapHours);
  log(`scanned ${mapping.length} items, ${candidates.length} candidates, gap ${place.gapHours.toFixed(1)}h`);

  const stats = { scanned: mapping.length, candidates: candidates.length, evaluated: 0, excludedFalling: 0, excludedThinHistory: 0 };
  const drafts: Omit<Recommendation, "recId" | "ts">[] = [];
  for (const c of candidates) {
    let series;
    try { series = await wiki.timeseries(c.item.id, "1h"); } catch (e) { log(`timeseries ${c.item.name}: ${(e as Error).message}`); continue; }
    stats.evaluated++;
    const r = evaluate(c, densify(series), { cfg, exempt, nowMs, gapHours: place.gapHours, nextCheckAt: place.nextCheckAt });
    if (r.ok) drafts.push(r.rec);
    else if (r.reason === "falling") stats.excludedFalling++;
    else if (r.reason === "thin-history") stats.excludedThinHistory++;
  }

  const rank = (t: "gear" | "quick") => drafts.filter((d) => d.type === t).sort((a, b) => b.expProfit - a.expProfit).slice(0, cfg.method.shortlistPerType);
  const { shown, appended } = reconcile([...rank("gear"), ...rank("quick")], prevLog, nowMs, cfg.log);

  const plan: PlanFile = {
    generatedAt: nowMs, configVersion: cfg.version,
    placementAt: place.placementAt, nextCheckAt: place.nextCheckAt, gapHours: place.gapHours, inWindow: place.inWindow,
    gear: shown.filter((r) => r.type === "gear"), quick: shown.filter((r) => r.type === "quick"),
    stats,
  };
  return { plan, appended };
}

/**
 * Links real trades (Flipping Utilities) to logged recommendations and measures margin capture.
 *
 * Linking rule (SPEC §6): a buy is linked to the most recent recommendation for the same item
 * that was logged before the buy started and was still current (until its check-back time plus
 * a grace period), and the offer size is within the recommended quantity. Unlinked trades are
 * treated as personal purchases and ignored.
 * Sells are matched to buys first-in-first-out per item. A lot is complete when fully sold, or
 * when it passes the max hold time, in which case any remainder is marked at the live
 * instant-sell price after tax (a "forced exit").
 */
import type { Config, Recommendation, SlotType } from "./types";
import type { FuOffer } from "./fu";
import { geTax } from "./tax";
import { median } from "./stats";
import { gp } from "./format";

export interface Lot {
  buy: FuOffer;
  rec: Recommendation | null;
  qty: number;
  remaining: number;
  cost: number;
  proceeds: number;           // after tax, from real sells
  lastSellMs: number | null;
  status: "open" | "sold" | "forced";
  forcedMark: number;         // after-tax value of the remainder at the forced exit
  realized: number;
  predicted: number;
  holdHours: number | null;
}

export interface Report {
  fromMs: number;
  nowMs: number;
  lots: Lot[];
  linked: Lot[];
  completed: Lot[];
  openLinked: Lot[];
  capture: number | null;
  /** What the model itself expected to capture on these same flips (calibration check). */
  modelExpectedCapture: number | null;
  realizedTotal: number;
  predictedTotal: number;
  fill: { linkedBuys: number; filledByCheckBack: number; rate: number | null };
  holdMedianHours: Record<SlotType, number | null>;
  byType: Record<SlotType, { flips: number; realized: number; predicted: number; capture: number | null }>;
  worst: Lot[];
  recsLogged: number;
  unlinkedBuys: number;
  verdict: string;
}

export interface ReportInput {
  recs: Recommendation[];
  offers: FuOffer[];
  liveLow: Record<number, number>;
  exempt: Set<number>;
  cfg: Config;
  nowMs: number;
  fromMs: number;
}

const H = 3_600_000;
const startOf = (o: FuOffer) => o.startedMs ?? o.timeMs;

export function linkRec(buy: FuOffer, recs: Recommendation[], cfg: Config): Recommendation | null {
  const start = startOf(buy);
  const size = buy.size || buy.qty;
  let best: Recommendation | null = null;
  for (const r of recs) {
    if (r.itemId !== buy.itemId || r.ts > start) continue;
    if (start > r.checkBackAt + cfg.evaluation.linkGraceHours * H) continue;
    if (size > Math.ceil(r.qty * cfg.evaluation.qtyTolerance)) continue;
    if (!best || r.ts > best.ts) best = r;
  }
  return best;
}

export function buildReport({ recs, offers, liveLow, exempt, cfg, nowMs, fromMs }: ReportInput): Report {
  const inRange = offers.filter((o) => startOf(o) >= fromMs && o.qty > 0);
  const lots: Lot[] = [];
  const queues = new Map<number, Lot[]>();
  for (const o of inRange.filter((o) => o.isBuy).sort((a, b) => startOf(a) - startOf(b))) {
    const lot: Lot = {
      buy: o, rec: linkRec(o, recs, cfg), qty: o.qty, remaining: o.qty, cost: o.qty * o.price, proceeds: 0,
      lastSellMs: null, status: "open", forcedMark: 0, realized: 0, predicted: 0, holdHours: null,
    };
    lots.push(lot);
    queues.set(o.itemId, [...(queues.get(o.itemId) ?? []), lot]);
  }
  for (const s of inRange.filter((o) => !o.isBuy).sort((a, b) => a.timeMs - b.timeMs)) {
    let left = s.qty;
    const perUnit = s.price - geTax(s.price, s.itemId, exempt);
    for (const lot of queues.get(s.itemId) ?? []) {
      if (left <= 0) break;
      if (lot.remaining <= 0 || lot.buy.timeMs > s.timeMs) continue;
      const take = Math.min(left, lot.remaining);
      lot.remaining -= take; left -= take;
      lot.proceeds += take * perUnit;
      lot.lastSellMs = s.timeMs;
    }
  }
  for (const lot of lots) {
    const bought = lot.buy.timeMs;
    if (lot.remaining === 0) {
      lot.status = "sold";
      lot.holdHours = lot.lastSellMs != null ? (lot.lastSellMs - bought) / H : null;
    } else if (nowMs - bought >= cfg.maxHoldHours * H) {
      lot.status = "forced";
      const low = liveLow[lot.buy.itemId] ?? lot.buy.price;
      lot.forcedMark = lot.remaining * (low - geTax(low, lot.buy.itemId, exempt));
      lot.holdHours = cfg.maxHoldHours;
    }
    lot.realized = lot.proceeds + lot.forcedMark - lot.cost;
    lot.predicted = lot.rec ? lot.rec.predMarginEach * lot.qty : 0;
  }

  const linked = lots.filter((l) => l.rec);
  const completed = linked.filter((l) => l.status !== "open");
  const sum = (ls: Lot[], f: (l: Lot) => number) => ls.reduce((a, l) => a + f(l), 0);
  const realizedTotal = sum(completed, (l) => l.realized);
  const predictedTotal = sum(completed, (l) => l.predicted);
  const capture = predictedTotal > 0 ? realizedTotal / predictedTotal : null;
  // Model's own expectation given the buy filled: expProfit / (pFill * qty) per unit.
  const expectedGivenFill = sum(completed, (l) => (l.rec!.pFill > 0 ? (l.rec!.expProfit / (l.rec!.pFill * l.rec!.qty)) * l.qty : 0));
  const modelExpectedCapture = predictedTotal > 0 ? expectedGivenFill / predictedTotal : null;

  // Fill rate over linked buy OFFERS (including cancelled / unfilled ones that were linkable)
  const linkedOffers = offers.filter((o) => o.isBuy && startOf(o) >= fromMs).map((o) => ({ o, rec: linkRec(o, recs, cfg) })).filter((x) => x.rec);
  const decided = linkedOffers.filter(({ o, rec }) => o.state === "BOUGHT" || o.state === "CANCELLED_BUY" || nowMs > rec!.checkBackAt);
  const filledByCheck = decided.filter(({ o, rec }) => o.state === "BOUGHT" && o.timeMs <= rec!.checkBackAt + cfg.evaluation.linkGraceHours * H);

  const types: SlotType[] = ["gear", "quick"];
  const byType = Object.fromEntries(types.map((t) => {
    const ls = completed.filter((l) => l.rec!.type === t);
    const r = sum(ls, (l) => l.realized), p = sum(ls, (l) => l.predicted);
    return [t, { flips: ls.length, realized: r, predicted: p, capture: p > 0 ? r / p : null }];
  })) as Report["byType"];
  const holdMedianHours = Object.fromEntries(types.map((t) =>
    [t, median(completed.filter((l) => l.rec!.type === t && l.holdHours != null).map((l) => l.holdHours!))])) as Report["holdMedianHours"];

  const target = cfg.evaluation.targetCapture, need = cfg.evaluation.minLinkedFlips;
  const verdict =
    completed.length < need
      ? `Not enough data yet: ${completed.length} of ${need} linked flips completed.`
      : capture == null
        ? "No positive predicted profit to compare against."
        : capture >= target
          ? `Meets target: ${pct(capture)} of predicted margin captured over ${completed.length} flips (target ${pct(target)}).`
          : `Below target: ${pct(capture)} of predicted margin captured over ${completed.length} flips (target ${pct(target)}).`;

  return {
    fromMs, nowMs, lots, linked, completed,
    openLinked: linked.filter((l) => l.status === "open"),
    capture, modelExpectedCapture, realizedTotal, predictedTotal,
    fill: { linkedBuys: decided.length, filledByCheckBack: filledByCheck.length, rate: decided.length ? filledByCheck.length / decided.length : null },
    holdMedianHours, byType,
    worst: [...completed].sort((a, b) => (a.realized - a.predicted) - (b.realized - b.predicted)).slice(0, 5),
    recsLogged: recs.filter((r) => r.ts >= fromMs && r.ts <= nowMs).length,
    unlinkedBuys: lots.length - linked.length,
    verdict,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function reportMarkdown(r: Report): string {
  const row = (l: Lot) =>
    `| ${l.rec!.name} | ${l.rec!.type} | ${l.qty} | ${gp(l.buy.price)} | ${gp(l.rec!.bid)}→${gp(l.rec!.sell)} | ${gp(l.predicted)} | ${gp(l.realized)} | ${l.status} | ${l.holdHours?.toFixed(1) ?? "-"}h |`;
  return [
    `# Weekly flip report: ${day(r.fromMs)} to ${day(r.nowMs)}`,
    "",
    `**${r.verdict}**`,
    "",
    `| Metric | Value |`, `|---|---|`,
    `| Margin capture (primary) | ${r.capture == null ? "n/a" : pct(r.capture)} |`,
    `| Model-expected capture (calibration) | ${r.modelExpectedCapture == null ? "n/a" : pct(r.modelExpectedCapture)} |`,
    `| Realized / predicted | ${gp(r.realizedTotal)} / ${gp(r.predictedTotal)} |`,
    `| Completed linked flips | ${r.completed.length} (open: ${r.openLinked.length}) |`,
    `| Fill rate by check-back | ${r.fill.rate == null ? "n/a" : pct(r.fill.rate)} (${r.fill.filledByCheckBack}/${r.fill.linkedBuys}) |`,
    `| Median hold (gear / quick) | ${r.holdMedianHours.gear?.toFixed(1) ?? "-"}h / ${r.holdMedianHours.quick?.toFixed(1) ?? "-"}h |`,
    `| Capture gear / quick | ${fmtCap(r.byType.gear)} / ${fmtCap(r.byType.quick)} |`,
    `| Recommendations logged | ${r.recsLogged} |`,
    `| Unlinked buys ignored | ${r.unlinkedBuys} |`,
    "",
    "## 5 worst misses (realized minus predicted)",
    "| Item | Type | Qty | Paid | Rec bid→sell | Predicted | Realized | Status | Hold |", "|---|---|---|---|---|---|---|---|---|",
    ...r.worst.map(row),
    "",
    "## All completed linked flips",
    "| Item | Type | Qty | Paid | Rec bid→sell | Predicted | Realized | Status | Hold |", "|---|---|---|---|---|---|---|---|---|",
    ...r.completed.map(row),
    "",
    "_Proposed changes go in DECISIONS.md and need approval. No parameter changes before 30 linked flips._",
  ].join("\n");
}

const fmtCap = (t: { flips: number; capture: number | null }) => `${t.capture == null ? "n/a" : pct(t.capture)} (${t.flips})`;

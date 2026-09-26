import { describe, expect, it } from "vitest";
import cfgJson from "../config.json";
import type { Config, Recommendation, SeriesPoint } from "../src/engine/types";
import { buildExemptIds, geTax, isExemptName } from "../src/engine/tax";
import { dueDigest, inWindow, placement } from "../src/engine/schedule";
import { densify, flipOdds, percentile, trendPctPerDay } from "../src/engine/stats";
import { allocationPerSlot, evaluate } from "../src/engine/recommend";
import { reconcile } from "../src/engine/log";
import { parseFlippingUtilities, parseTime } from "../src/engine/fu";
import { buildReport } from "../src/engine/report";
import { decideNotifications, emptyNotifyState } from "../src/engine/notify";

const cfg = cfgJson as Config;
const H = 3_600_000;
// Chicago is UTC-5 in late September (CDT). Fri 2026-09-25 is a weekday; Sat 2026-09-26 weekend.
const chi = (iso: string) => Date.parse(iso + "-05:00");

describe("tax", () => {
  const ex = new Set<number>([1]);
  it("2% rounded down, none under 50gp, capped at 5m, exempt items free", () => {
    expect(geTax(49, 2, ex)).toBe(0);
    expect(geTax(50, 2, ex)).toBe(1);
    expect(geTax(1_219_059, 2, ex)).toBe(24_381);
    expect(geTax(1_750_000_000, 2, ex)).toBe(5_000_000);
    expect(geTax(10_000, 1, ex)).toBe(0);
  });
  it("exempt names use the mapping's '(tablet)' spelling", () => {
    expect(isExemptName("Falador teleport (tablet)")).toBe(true);
    expect(isExemptName("Teleport to house (tablet)")).toBe(true);
    expect(isExemptName("Energy potion(4)")).toBe(true);
    expect(isExemptName("Super energy(4)")).toBe(false);
    expect([...buildExemptIds([{ id: 7, name: "Cooked meat" }, { id: 8, name: "Yew logs" }])]).toEqual([7]);
  });
});

describe("schedule (America/Chicago)", () => {
  it("knows the play windows", () => {
    expect(inWindow(chi("2026-09-25T06:30:00"), cfg)).toBe(true);
    expect(inWindow(chi("2026-09-25T12:00:00"), cfg)).toBe(false);
    expect(inWindow(chi("2026-09-25T23:59:00"), cfg)).toBe(true);
    expect(inWindow(chi("2026-09-26T07:00:00"), cfg)).toBe(true);  // Saturday 06-08
    expect(inWindow(chi("2026-09-26T09:00:00"), cfg)).toBe(false); // Saturday gap 08-10
    expect(inWindow(chi("2026-09-26T20:30:00"), cfg)).toBe(false); // Saturday gap 20-21
  });
  it("morning offers sit until the after-work session", () => {
    const p = placement(chi("2026-09-25T06:05:00"), cfg);
    expect(p.nextCheckAt).toBe(chi("2026-09-25T16:00:00"));
    expect(p.gapHours).toBeCloseTo(9 + 55 / 60, 3);
  });
  it("outside a window, plans for the next session", () => {
    const p = placement(chi("2026-09-25T12:00:00"), cfg);
    expect(p.inWindow).toBe(false);
    expect(p.placementAt).toBe(chi("2026-09-25T16:00:00"));
    expect(p.nextCheckAt).toBe(chi("2026-09-25T22:00:00"));
  });
  it("weekend sessions: check-in stays stable within a session", () => {
    const a = placement(chi("2026-09-26T10:10:00"), cfg);
    const b = placement(chi("2026-09-26T12:40:00"), cfg);
    expect(a.nextCheckAt).toBe(chi("2026-09-26T16:00:00"));
    expect(b.nextCheckAt).toBe(a.nextCheckAt);
    expect(placement(chi("2026-09-26T19:00:00"), cfg).nextCheckAt).toBe(chi("2026-09-26T21:00:00"));
  });
  it("Friday late session rolls to Saturday 06:00", () => {
    expect(placement(chi("2026-09-25T22:30:00"), cfg).nextCheckAt).toBe(chi("2026-09-26T06:00:00"));
  });
  it("digest is due 15 minutes before a check-in, once", () => {
    expect(dueDigest(chi("2026-09-25T15:45:00"), cfg)).toBe(chi("2026-09-25T16:00:00"));
    expect(dueDigest(chi("2026-09-25T15:50:00"), cfg)).toBe(chi("2026-09-25T16:00:00"));
    expect(dueDigest(chi("2026-09-25T13:00:00"), cfg)).toBeNull();
    expect(dueDigest(chi("2026-09-26T09:45:00"), cfg)).toBe(chi("2026-09-26T10:00:00"));
    expect(dueDigest(chi("2026-09-26T11:45:00"), cfg)).toBeNull();
  });
});

/** Oscillating market: low swings 95..105 every 12h, high sits 4% above low. */
function wave(hours: number, drift = 0): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const t0 = 1_780_000_000 - (1_780_000_000 % 3600);
  for (let i = 0; i < hours; i++) {
    const low = Math.round((100 + 5 * Math.sin((2 * Math.PI * i) / 12)) * (1 + drift) ** i * 1000);
    out.push({ timestamp: t0 + i * 3600, avgLowPrice: low, avgHighPrice: Math.round(low * 1.04), lowPriceVolume: 40, highPriceVolume: 40 });
  }
  return out;
}

describe("stats", () => {
  it("percentile interpolates", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.5)).toBeNull();
  });
  it("detects decline", () => {
    expect(trendPctPerDay(densify(wave(300, -0.002)), 72)).toBeLessThan(-4);
    expect(Math.abs(trendPctPerDay(densify(wave(300)), 72))).toBeLessThan(1);
  });
  it("deeper bids fill less often; bigger markups exit less often", () => {
    const d = densify(wave(365));
    const shallow = flipOdds(d, 6, 0.0, 0.03, 72, 0.02);
    const deep = flipOdds(d, 6, 0.05, 0.03, 72, 0.02);
    expect(shallow.pFill).toBeGreaterThan(deep.pFill);
    const easy = flipOdds(d, 6, 0.01, 0.02, 72, 0.02);
    const hard = flipOdds(d, 6, 0.01, 0.30, 72, 0.02);
    expect(easy.pExit).toBeGreaterThan(hard.pExit);
    expect(hard.pExit).toBe(0);
    expect(hard.avgLossRel).toBeLessThan(0.05);
  });
  it("does not count censored windows as failures", () => {
    const d = densify(wave(80));
    const o = flipOdds(d, 4, 0, 0.01, 72, 0.02);
    expect(o.nExit).toBeLessThanOrEqual(o.pFill * o.nFill + 1e-9);
  });
});

describe("recommend", () => {
  const ctx = { cfg, exempt: new Set<number>(), nowMs: Date.now(), gapHours: 6, nextCheckAt: 0 };
  const item = { id: 99, name: "Test sword", limit: 8 };
  it("sizes gear within the slot budget and buy limit", () => {
    const series = wave(365).map((p) => ({ ...p, avgLowPrice: p.avgLowPrice! * 50, avgHighPrice: Math.round(p.avgLowPrice! * 50 * 1.06), lowPriceVolume: 6, highPriceVolume: 6 }));
    const d = densify(series);
    const low = series[series.length - 1].avgLowPrice!;
    const r = evaluate({ item, type: "gear", low, high: Math.round(low * 1.06), naive: 0 }, d, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rec.qty).toBeGreaterThanOrEqual(1);
      expect(r.rec.qty * r.rec.bid).toBeLessThanOrEqual(allocationPerSlot(cfg, "gear"));
      expect(r.rec.qty).toBeLessThanOrEqual(8);
      expect(r.rec.predMarginEach).toBe(r.rec.sell - r.rec.taxEach - r.rec.bid);
      expect(r.rec.reasons.length).toBe(3);
    }
  });
  it("P7: caps quantity by buyers on the sell side, not just sellers on the buy side", () => {
    // ~1,000gp item: plenty of instant-sellers (easy to buy), few instant-buyers (hard to sell)
    const series = wave(365).map((p) => ({
      ...p, avgLowPrice: Math.round(p.avgLowPrice! / 100), avgHighPrice: Math.round(p.avgHighPrice! / 100),
      lowPriceVolume: 5000, highPriceVolume: 20,
    }));
    const low = series[series.length - 1].avgLowPrice!;
    const bulk = { id: 98, name: "Test bolts", limit: 11_000 };
    const loose = { ...cfg, method: { ...cfg.method, minProfitPerSlot: { gear: 0, quick: 0 } } } as Config;
    const r = evaluate({ item: bulk, type: "quick", low, high: Math.round(low * 1.04), naive: 0 }, densify(series), { ...ctx, cfg: loose, gapHours: 6 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // buy side alone would allow 0.2 * 5000/h * 6h = 6,000; buyers (20/h) allow at most 0.2 * 20 * 72h = 288
      expect(r.rec.qty).toBeLessThanOrEqual(288);
      expect(r.rec.reasons[2]).toContain("sell side");
    }
  });
  it("rejects falling items", () => {
    const series = wave(365, -0.003).map((p) => ({ ...p, avgLowPrice: p.avgLowPrice! * 50, avgHighPrice: p.avgHighPrice! * 50, lowPriceVolume: 6, highPriceVolume: 6 }));
    const low = series[series.length - 1].avgLowPrice!;
    const r = evaluate({ item, type: "gear", low, high: low, naive: 0 }, densify(series), ctx);
    expect(r).toEqual({ ok: false, reason: "falling" });
  });
});

const baseRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  recId: "99-1", ts: 1_000, itemId: 99, name: "Test sword", type: "gear", bid: 5_000_000, sell: 5_300_000, qty: 2, limit: 8,
  taxEach: 106_000, predMarginEach: 194_000, predProfit: 388_000, pFill: 0.7, pExit: 0.8, nFillSamples: 300, nExitSamples: 200,
  medianHoursToExit: 10, expProfit: 200_000, gapHours: 6, checkBackAt: 1_000 + 6 * H, trendPctPerDay: 0, dailyVolume: 100,
  strong: true, reasons: [], ...over,
});

describe("log", () => {
  it("reuses the logged version unless something material changed", () => {
    const prev = [baseRec()];
    const { recId, ts, ...draft } = baseRec();
    const same = reconcile([{ ...draft, bid: 5_010_000 }], prev, 2_000, cfg.log);
    expect(same.appended).toHaveLength(0);
    expect(same.shown[0].bid).toBe(5_000_000);
    const moved = reconcile([{ ...draft, bid: 5_200_000 }], prev, 2_000, cfg.log);
    expect(moved.appended).toHaveLength(1);
    expect(moved.shown[0].recId).toBe("99-2000");
    const stamped = reconcile([{ ...draft, bid: 5_200_000 }], prev, 2_000, cfg.log, "9.9.9");
    expect(stamped.appended[0].configVersion).toBe("9.9.9");
  });
});

describe("Flipping Utilities import + report", () => {
  it("parses times in several formats", () => {
    expect(parseTime(1_790_000_000)).toBe(1_790_000_000_000);
    expect(parseTime(1_790_000_000_123)).toBe(1_790_000_000_123);
    expect(parseTime("2026-09-25T00:00:00Z")).toBe(Date.parse("2026-09-25T00:00:00Z"));
    expect(parseTime({ seconds: 10, nanos: 5_000_000 })).toBe(10_005);
  });

  const t0 = Date.parse("2026-09-25T11:00:00Z");
  const fuFile = {
    trades: [
      { id: 99, name: "Test sword", h: { sO: [
        { uuid: "b1", b: true, id: 99, cQIT: 2, tQIT: 2, p: 5_000_000, t: (t0 + 2 * H) / 1000, s: 0, st: "BOUGHT", tradeStartedAt: (t0 + 10 * 60_000) / 1000 },
        { uuid: "s1", b: false, id: 99, cQIT: 2, tQIT: 2, p: 5_250_000, t: (t0 + 20 * H) / 1000, s: 0, st: "SOLD" },
      ] } },
      { id: 50, name: "Dragon bones", h: { sO: [
        { uuid: "p1", b: true, id: 50, cQIT: 100, tQIT: 100, p: 2_000, t: (t0 + H) / 1000, s: 1, st: "BOUGHT" },
      ] } },
    ],
    lastOffers: { "2": { uuid: "e", id: 0, st: "EMPTY", t: t0 / 1000 } },
  };

  it("links a recommended flip, ignores personal buys, and measures capture", () => {
    const offers = parseFlippingUtilities(fuFile);
    expect(offers).toHaveLength(3);
    const rec = baseRec({ ts: t0, recId: "99-x", checkBackAt: t0 + 6 * H });
    const r = buildReport({ recs: [rec], offers, liveLow: {}, exempt: new Set(), cfg, nowMs: t0 + 30 * H, fromMs: t0 - H });
    expect(r.linked).toHaveLength(1);
    expect(r.unlinkedBuys).toBe(1);
    expect(r.completed[0].status).toBe("sold");
    // sold 2 @ 5.25m, tax 105k each -> 10.29m proceeds; cost 10m -> +290k vs predicted 388k
    expect(r.completed[0].realized).toBe(290_000);
    expect(r.capture).toBeCloseTo(290_000 / 388_000, 5);
    expect(r.fill.rate).toBe(1);
  });

  it("forces an exit after 72h at the live instant-sell price", () => {
    const offers = parseFlippingUtilities({ trades: [fuFile.trades[0]].map((t) => ({ ...t, h: { sO: [t.h.sO[0]] } })) });
    const rec = baseRec({ ts: t0, checkBackAt: t0 + 6 * H });
    const r = buildReport({ recs: [rec], offers, liveLow: { 99: 4_900_000 }, exempt: new Set(), cfg, nowMs: t0 + 80 * H, fromMs: t0 - H });
    expect(r.completed[0].status).toBe("forced");
    expect(r.completed[0].realized).toBe(2 * (4_900_000 - 98_000) - 10_000_000);
  });
});

describe("notifications", () => {
  it("sends one digest per check-in and alerts strong buys only while awake", () => {
    const rec = baseRec();
    const plan = { generatedAt: 0, configVersion: "t", placementAt: 0, nextCheckAt: chi("2026-09-25T22:00:00"), gapHours: 6, inWindow: false, gear: [rec], quick: [], stats: { scanned: 0, candidates: 0, evaluated: 0, excludedFalling: 0, excludedThinHistory: 0 } };
    const first = decideNotifications(plan, cfg, emptyNotifyState(), chi("2026-09-25T15:46:00"), "url");
    expect(first.messages).toHaveLength(2); // digest + strong buy (within lead of window)
    const again = decideNotifications(plan, cfg, first.state, chi("2026-09-25T16:01:00"), "url");
    expect(again.messages).toHaveLength(0);
    const atWork = decideNotifications(plan, cfg, emptyNotifyState(), chi("2026-09-25T12:00:00"), "url");
    expect(atWork.messages).toHaveLength(0);
  });
});

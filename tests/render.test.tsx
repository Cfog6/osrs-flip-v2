/** Smoke test: the page components render real engine output without throwing. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import cfgJson from "../config.json";
import type { Config, PlanFile, Recommendation } from "../src/engine/types";
import { buildReport } from "../src/engine/report";
import { parseFlippingUtilities } from "../src/engine/fu";
import Plan from "../src/web/Plan";
import Review from "../src/web/Review";

const cfg = cfgJson as Config;
const H = 3_600_000;
const now = Date.parse("2026-09-25T21:10:00Z");
const rec: Recommendation = {
  recId: "99-1", ts: now - H, itemId: 99, name: "Test sword", type: "gear", bid: 5_000_000, sell: 5_300_000, qty: 2, limit: 8,
  taxEach: 106_000, predMarginEach: 194_000, predProfit: 388_000, pFill: 0.7, pExit: 0.8, nFillSamples: 300, nExitSamples: 200,
  medianHoursToExit: 10, expProfit: 200_000, gapHours: 6, checkBackAt: now + 5 * H, trendPctPerDay: 0, dailyVolume: 100, strong: true, reasons: ["a", "b", "c"],
};
const quickRec: Recommendation = { ...rec, recId: "50-1", itemId: 50, name: "Dragon bones", type: "quick", bid: 2000, sell: 2100, qty: 3000, predMarginEach: 58, predProfit: 174_000, expProfit: 60_000, pFill: 0.2, strong: false };
const plan: PlanFile = {
  generatedAt: now - 5 * 60_000, configVersion: "2.0.0", placementAt: now, nextCheckAt: now + 5 * H, gapHours: 6, inWindow: true,
  gear: [rec], quick: [quickRec], stats: { scanned: 1, candidates: 1, evaluated: 1, excludedFalling: 0, excludedThinHistory: 0 },
};
const offers = parseFlippingUtilities({ trades: [{ id: 99, name: "Test sword", h: { sO: [
  { uuid: "b1", b: true, id: 99, cQIT: 2, tQIT: 2, p: 5_000_000, t: (now - 50 * 60_000) / 1000, s: 0, st: "BOUGHT" },
] } }] });

describe("page render", () => {
  it("Plan shows holdings and remaining free slots", () => {
    const report = buildReport({ recs: [rec, quickRec], offers, liveLow: {}, exempt: new Set(), cfg, nowMs: now, fromMs: now - 24 * H });
    const html = renderToStaticMarkup(<Plan cfg={cfg} plan={plan} live={{ 50: { high: 2100, highTime: 0, low: 1990, lowTime: 0 } }} report={report} now={now} hasImport />);
    expect(html).toContain("Holding (1)");
    expect(html).toContain("List at <b>5.30m</b>");
    expect(html).toContain("Your 6 free slots");
    expect(html).toContain("Dragon bones");
    expect(html).toContain("fills now");
    expect(html).toContain("long shot");
  });
  it("Review renders a report", () => {
    const report = buildReport({ recs: [rec], offers, liveLow: {}, exempt: new Set(), cfg, nowMs: now, fromMs: now - 24 * H });
    const html = renderToStaticMarkup(<Review cfg={cfg} report={report} imported={{ importedAt: now, fileName: "HardContract.json", offers }} onImported={() => {}} testStart="" onTestStart={() => {}} recCount={2} />);
    expect(html).toContain("Not enough data yet");
    expect(html).toContain("Download weekly report");
  });
});

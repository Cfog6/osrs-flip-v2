import { useCallback, useEffect, useMemo, useState } from "react";
import cfgJson from "../../config.json";
import type { Config, LatestQuote, PlanFile, Recommendation } from "../engine/types";
import { buildReport } from "../engine/report";
import { loadExempt, loadImported, loadLive, loadPlan, loadRecLog, loadTestStart, type Imported } from "./data";
import Plan from "./Plan";
import Review from "./Review";

const cfg = cfgJson as Config;

export default function App() {
  const [tab, setTab] = useState<"plan" | "review">("plan");
  const [plan, setPlan] = useState<PlanFile | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [live, setLive] = useState<Record<number, LatestQuote>>({});
  const [exempt, setExempt] = useState<Set<number>>(new Set());
  const [imported, setImported] = useState<Imported | null>(loadImported());
  const [testStart, setTestStart] = useState<string>(loadTestStart());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    setError(null);
    setNow(Date.now());
    const results = await Promise.allSettled([loadPlan(), loadRecLog(), loadLive(), loadExempt()]);
    const [p, l, lv, ex] = results;
    if (p.status === "fulfilled") setPlan(p.value); else setError(String(p.reason?.message ?? p.reason));
    if (l.status === "fulfilled") setRecs(l.value);
    if (lv.status === "fulfilled") setLive(lv.value);
    if (ex.status === "fulfilled") setExempt(ex.value);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5 * 60_000); return () => clearInterval(id); }, [refresh]);

  const fromMs = useMemo(() => {
    if (testStart) return Date.parse(testStart + "T00:00:00");
    return recs.length ? Math.min(...recs.map((r) => r.ts)) : now - 14 * 86_400_000;
  }, [testStart, recs, now]);

  const report = useMemo(() => {
    if (!imported) return null;
    const liveLow = Object.fromEntries(Object.entries(live).filter(([, q]) => q.low).map(([k, q]) => [Number(k), q.low!]));
    return buildReport({ recs, offers: imported.offers, liveLow, exempt, cfg, nowMs: now, fromMs });
  }, [imported, recs, live, exempt, now, fromMs]);

  return (
    <div className="app">
      <header>
        <h1>OSRS Flip Assistant</h1>
        <span className="muted">{cfg.account} · stake {Math.round(cfg.stake / 1e6)}m · {cfg.slots.gear + cfg.slots.quick} slots</span>
        <nav>
          <button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Plan</button>
          <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Review</button>
          <button onClick={refresh} title="Reload plan and live prices">↻</button>
        </nav>
      </header>
      {error && <div className="banner warn">{error}</div>}
      {tab === "plan" ? (
        <Plan cfg={cfg} plan={plan} live={live} report={report} now={now} hasImport={!!imported} />
      ) : (
        <Review cfg={cfg} report={report} imported={imported} onImported={setImported} testStart={testStart} onTestStart={setTestStart} recCount={recs.length} />
      )}
      <footer className="muted">
        Prices: OSRS Wiki real-time API (RuneLite players only, so thin items are noisy). Decision support, not a guarantee.
      </footer>
    </div>
  );
}

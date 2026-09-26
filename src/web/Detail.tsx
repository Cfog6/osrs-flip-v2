import { useEffect, useState } from "react";
import type { Config, Recommendation, SeriesPoint } from "../engine/types";
import { gp } from "../engine/format";
import { localLabel } from "../engine/schedule";
import { loadSeries } from "./data";

export default function Detail({ rec, cfg }: { rec: Recommendation; cfg: Config }) {
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadSeries(rec.itemId).then((s) => setSeries(s.slice(-72))).catch((e) => setErr(String(e))); }, [rec.itemId]);

  return (
    <div className="detail">
      <div className="chart">{err ? <p className="bad">{err}</p> : series ? <Chart pts={series} bid={rec.bid} sell={rec.sell} /> : <p className="muted">Loading chart…</p>}</div>
      <div>
        <ul className="reasons">{rec.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <table className="kv">
          <tbody>
            <tr><td>Margin each (after {gp(rec.taxEach)} tax)</td><td>{gp(rec.predMarginEach)}</td></tr>
            <tr><td>Buy limit (4h)</td><td>{rec.limit.toLocaleString()}</td></tr>
            <tr><td>Median time to sell after filling</td><td>{rec.medianHoursToExit == null ? "–" : `${rec.medianHoursToExit}h`}</td></tr>
            <tr><td>Recommendation logged</td><td>{localLabel(rec.ts, cfg.timezone)} · id {rec.recId}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chart({ pts, bid, sell }: { pts: SeriesPoint[]; bid: number; sell: number }) {
  const W = 520, Hh = 180, pad = 4;
  const vals = pts.flatMap((p) => [p.avgLowPrice, p.avgHighPrice]).filter((v): v is number => v != null).concat([bid, sell]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => pad + (i / Math.max(1, pts.length - 1)) * (W - 2 * pad);
  const y = (v: number) => Hh - pad - ((v - lo) / Math.max(1, hi - lo)) * (Hh - 2 * pad);
  const path = (key: "avgLowPrice" | "avgHighPrice") => {
    let d = "", pen = false;
    pts.forEach((p, i) => { const v = p[key]; if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true; });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Last 72 hours of prices with bid and sell lines">
      <line x1={pad} x2={W - pad} y1={y(sell)} y2={y(sell)} className="lineSell" />
      <line x1={pad} x2={W - pad} y1={y(bid)} y2={y(bid)} className="lineBid" />
      <path d={path("avgHighPrice")} className="lineHigh" />
      <path d={path("avgLowPrice")} className="lineLow" />
      <text x={W - pad} y={y(sell) - 4} textAnchor="end" className="lbl">sell {gp(sell)}</text>
      <text x={W - pad} y={y(bid) + 12} textAnchor="end" className="lbl">bid {gp(bid)}</text>
      <text x={pad} y={12} className="lbl">last 72h · orange = instant-buy avg · blue = instant-sell avg</text>
    </svg>
  );
}

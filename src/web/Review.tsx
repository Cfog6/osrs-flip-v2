import { useState } from "react";
import type { Config } from "../engine/types";
import { parseFlippingUtilities } from "../engine/fu";
import { reportMarkdown, type Lot, type Report } from "../engine/report";
import { gp } from "../engine/format";
import { clearImported, saveImported, saveTestStart, type Imported } from "./data";

interface Props {
  cfg: Config; report: Report | null; imported: Imported | null; onImported: (x: Imported | null) => void;
  testStart: string; onTestStart: (d: string) => void; recCount: number;
}

export default function Review({ cfg, report, imported, onImported, testStart, onTestStart, recCount }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function handleFile(f: File) {
    try {
      const offers = parseFlippingUtilities(JSON.parse(await f.text()));
      const x: Imported = { importedAt: Date.now(), fileName: f.name, offers };
      if (!saveImported(x)) setMsg("Imported, but the browser couldn't store it (file too large?). It will be lost on reload.");
      else setMsg(`Imported ${offers.length.toLocaleString()} offers from ${f.name}.`);
      onImported(x);
    } catch (e) {
      setMsg(`Couldn't read that file: ${(e as Error).message}`);
    }
  }

  function download() {
    if (!report) return;
    const blob = new Blob([reportMarkdown(report)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `flip-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
  }

  const lastTrade = imported?.offers.length ? Math.max(...imported.offers.map((o) => o.timeMs)) : null;

  return (
    <main>
      <section
        className={`drop ${drag ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <p>
          Drop <b>{cfg.account}.json</b> here, or <label className="link">choose file<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} /></label>.
        </p>
        <p className="muted small">
          Location: <code>%USERPROFILE%\.runelite\flipping\</code>. Flipping Utilities saves it when you log out, so log out (or close RuneLite) first.
          The file is read in this browser only and never uploaded.
        </p>
        {imported && (
          <p className="small">
            Loaded {imported.offers.length.toLocaleString()} offers from {imported.fileName} · last trade {lastTrade ? new Date(lastTrade).toLocaleString() : "–"}{" "}
            <button className="link" onClick={() => { clearImported(); onImported(null); setMsg("Cleared."); }}>clear</button>
          </p>
        )}
        {msg && <p className="small">{msg}</p>}
      </section>

      <section className="row">
        <label>Test started on <input type="date" value={testStart} onChange={(e) => { onTestStart(e.target.value); saveTestStart(e.target.value); }} /></label>
        <span className="muted small">{testStart ? "" : "(defaults to the first logged recommendation)"} · {recCount} recommendations logged so far</span>
      </section>

      {!report ? (
        <p className="muted">Import your file to see how the recommendations are performing.</p>
      ) : (
        <>
          <div className={`banner ${report.completed.length >= cfg.evaluation.minLinkedFlips ? (report.capture != null && report.capture >= cfg.evaluation.targetCapture ? "ok" : "warn") : ""}`}>
            <b>{report.verdict}</b>
            <button className="right" onClick={download}>Download weekly report (.md)</button>
          </div>
          <section className="cards">
            <Card k="Margin capture" v={pc(report.capture)} sub={`target ${pc(cfg.evaluation.targetCapture)}`} />
            <Card k="Model expected" v={pc(report.modelExpectedCapture)} sub="calibration check" />
            <Card k="Realized / predicted" v={`${gp(report.realizedTotal)} / ${gp(report.predictedTotal)}`} />
            <Card k="Linked flips done" v={`${report.completed.length} / ${cfg.evaluation.minLinkedFlips}`} sub={`${report.openLinked.length} open`} />
            <Card k="Fill by check-back" v={pc(report.fill.rate)} sub={`${report.fill.filledByCheckBack}/${report.fill.linkedBuys}`} />
            <Card k="Median hold" v={`${h(report.holdMedianHours.gear)} / ${h(report.holdMedianHours.quick)}`} sub="gear / quick" />
          </section>
          <p className="muted small">
            If your real capture tracks the model's expected capture, the predictions are honest even when they're below target.
            A gap between the two is what the weekly review should look at. {report.unlinkedBuys} unlinked buys (personal purchases) ignored.
          </p>
          <h2>Worst misses</h2>
          <LotTable lots={report.worst} />
          <h2>All completed linked flips</h2>
          <LotTable lots={report.completed} />
        </>
      )}
    </main>
  );
}

function Card({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return <div className="card"><div className="k">{k}</div><div className="v">{v}</div>{sub && <div className="muted small">{sub}</div>}</div>;
}

function LotTable({ lots }: { lots: Lot[] }) {
  if (!lots.length) return <p className="muted">None yet.</p>;
  return (
    <table>
      <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Paid</th><th>Rec bid → sell</th><th>Predicted</th><th>Realized</th><th>Status</th><th>Hold</th></tr></thead>
      <tbody>
        {lots.map((l) => (
          <tr key={l.buy.uuid}>
            <td>{l.rec!.name}</td><td>{l.rec!.type}</td><td>{l.qty.toLocaleString()}</td><td>{gp(l.buy.price)}</td>
            <td>{gp(l.rec!.bid)} → {gp(l.rec!.sell)}</td><td>{gp(l.predicted)}</td>
            <td className={l.realized >= 0 ? "good" : "bad"}>{gp(l.realized)}</td><td>{l.status}</td><td>{l.holdHours == null ? "–" : `${l.holdHours.toFixed(1)}h`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pc = (x: number | null) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);
const h = (x: number | null) => (x == null ? "–" : `${x.toFixed(0)}h`);

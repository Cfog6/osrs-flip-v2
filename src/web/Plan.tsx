import { Fragment, useState } from "react";
import type { Config, LatestQuote, PlanFile, Recommendation } from "../engine/types";
import type { Report } from "../engine/report";
import { localLabel } from "../engine/schedule";
import { gp } from "../engine/format";
import Detail from "./Detail";

interface Props { cfg: Config; plan: PlanFile | null; live: Record<number, LatestQuote>; report: Report | null; now: number; hasImport: boolean }

const H = 3_600_000;

export default function Plan({ cfg, plan, live, report, now, hasImport }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  if (!plan) return <p className="muted">Loading plan…</p>;

  const tz = cfg.timezone;
  const ageMin = Math.round((now - plan.generatedAt) / 60_000);
  const held = (report?.linked ?? []).filter((l) => l.remaining > 0);
  const heldIds = new Set(held.map((l) => l.buy.itemId));
  const pick = (list: Recommendation[], n: number) => list.filter((r) => !heldIds.has(r.itemId)).slice(0, n);
  const gear = pick(plan.gear, cfg.slots.gear), quick = pick(plan.quick, cfg.slots.quick);
  const freeSlots = Math.max(0, cfg.slots.gear + cfg.slots.quick - held.length);
  const slots = [...gear, ...quick].sort((a, b) => b.expProfit - a.expProfit).slice(0, freeSlots);
  const shownIds = new Set(slots.map((r) => r.recId));
  const more = [...plan.gear, ...plan.quick].filter((r) => !shownIds.has(r.recId) && !heldIds.has(r.itemId));

  const inFlips = held.reduce((a, l) => a + l.remaining * l.buy.price, 0);
  const realized = (report?.completed ?? []).reduce((a, l) => a + l.realized, 0);
  const totalExp = slots.reduce((a, r) => a + r.expProfit, 0);

  return (
    <main>
      <div className={`banner ${ageMin > 45 ? "warn" : ""}`}>
        <span>
          {plan.inWindow
            ? <>You're in a session. Offers placed now sit <b>~{Math.round(plan.gapHours)}h</b>. Next check-in <b>{localLabel(plan.nextCheckAt, tz)}</b>.</>
            : <>Next session <b>{localLabel(plan.placementAt, tz)}</b>. This plan is for then: offers sit <b>~{Math.round(plan.gapHours)}h</b>, until {localLabel(plan.nextCheckAt, tz)}.</>}
        </span>
        <span className="right muted">plan updated {ageMin < 1 ? "just now" : `${ageMin} min ago`}{ageMin > 45 && " (engine may be paused: check GitHub Actions)"}</span>
      </div>

      <section className="cards">
        <div className="card"><div className="k">Stake</div><div className="v">{gp(cfg.stake)}</div></div>
        <div className="card"><div className="k">In open flips</div><div className="v">{hasImport ? gp(inFlips) : "–"}</div></div>
        <div className="card"><div className="k">Realized so far</div><div className="v">{hasImport ? gp(realized) : "–"}</div></div>
        <div className="card"><div className="k">Plan's expected profit</div><div className="v">{gp(totalExp)}</div></div>
      </section>
      {!hasImport && <p className="muted">Import your Flipping Utilities file on the <b>Review</b> tab to see what you're holding.</p>}

      {held.length > 0 && (
        <section>
          <h2>Holding ({held.length})</h2>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Paid</th><th>Held</th><th>Do this</th></tr></thead>
            <tbody>
              {held.map((l) => {
                const hrs = (now - l.buy.timeMs) / H;
                const low = live[l.buy.itemId]?.low;
                const action = hrs >= cfg.maxHoldHours
                  ? <span className="bad">72h reached. Sell at market{low ? ` (~${gp(low)})` : ""}.</span>
                  : <>List at <b>{gp(l.rec!.sell)}</b>{hrs >= cfg.maxHoldHours - 12 && <span className="warnText"> · sell by {localLabel(l.buy.timeMs + cfg.maxHoldHours * H, cfg.timezone)}</span>}</>;
                return (
                  <tr key={l.buy.uuid}>
                    <td>{l.rec!.name}</td><td>{l.remaining.toLocaleString()}</td><td>{gp(l.buy.price)}</td>
                    <td>{hrs.toFixed(0)}h</td><td>{action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Your {freeSlots} free slot{freeSlots === 1 ? "" : "s"}</h2>
        <RecTable recs={slots} live={live} cfg={cfg} open={open} setOpen={setOpen} />
        {slots.length === 0 && <p className="muted">Nothing passes the filters right now. That's a valid answer: keep the GP.</p>}
        {more.length > 0 && (
          <>
            <button className="link" onClick={() => setShowMore(!showMore)}>{showMore ? "Hide" : "Show"} {more.length} alternatives</button>
            {showMore && <RecTable recs={more} live={live} cfg={cfg} open={open} setOpen={setOpen} />}
          </>
        )}
      </section>
      <p className="muted small">
        <b>Expected</b> = the plan's honest estimate, allowing for the chance the buy doesn't fill or the sell target isn't reached within {cfg.maxHoldHours}h.
        <b> If it works</b> = the margin you'd make hitting both prices, which is what the success metric compares your real results against.
      </p>
    </main>
  );
}

function RecTable({ recs, live, cfg, open, setOpen }: { recs: Recommendation[]; live: Record<number, LatestQuote>; cfg: Config; open: string | null; setOpen: (s: string | null) => void }) {
  if (!recs.length) return null;
  return (
    <table className="recs">
      <thead>
        <tr><th>Item</th><th>Type</th><th>Buy</th><th>Bid</th><th>Sell at</th><th>Check back</th><th>Expected</th><th>If it works</th><th>Odds</th></tr>
      </thead>
      <tbody>
        {recs.map((r) => {
          const low = live[r.itemId]?.low;
          const hint = low == null ? null : low < r.bid ? <span className="good" title="Live instant-sell price is below your bid: it should fill right away.">fills now</span>
            : low > r.bid * 1.02 ? <span className="warnText" title="Market has moved above the bid since the plan was made.">market {gp(low)}</span> : null;
          return (
            <Fragment key={r.recId}>
              <tr className="click" onClick={() => setOpen(open === r.recId ? null : r.recId)}>
                <td>{r.strong && <span className="star" title="Strong buy">★</span>}{r.name}</td>
                <td><span className={`tag ${r.type}`}>{r.type}</span></td>
                <td>{r.qty.toLocaleString()}</td>
                <td><b>{gp(r.bid)}</b> {hint}</td>
                <td><b>{gp(r.sell)}</b></td>
                <td>{localLabel(r.checkBackAt, cfg.timezone)}</td>
                <td className={r.expProfit > 0 ? "good" : "bad"}>{gp(r.expProfit)}</td>
                <td>{gp(r.predProfit)}</td>
                <td className={r.pFill < 0.25 ? "muted" : ""} title={`fill ${pct(r.pFill)} (n=${r.nFillSamples}) · exit ${pct(r.pExit)} (n=${r.nExitSamples})`}>
                  {pct(r.pFill)} / {pct(r.pExit)}{r.pFill < 0.25 && " · long shot"}
                </td>
              </tr>
              {open === r.recId && <tr><td colSpan={9}><Detail rec={r} cfg={cfg} /></td></tr>}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

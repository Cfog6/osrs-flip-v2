# Decisions log

Every proposal and decision, in order. This is also the record for the AI-coding experiment:
**who proposed what, on what evidence, and what was approved**. Claude proposes; Jason approves.

## 2026-09-25: v2 kickoff

| # | Decision | Proposed by | Status |
|---|---|---|---|
| D1 | Rebuild instead of refactoring v1 (scope creep, weak foundations) | Jason | Approved |
| D2 | Success = realized margin ≥ 60% of predicted, over ≥ 30 linked flips; 100m stake, 2-week test | Jason | Approved |
| P1 | TypeScript + Vite/React static page, shared engine, no Python | Claude | Approved |
| P2 | Public GitHub repo + Pages + Actions (engine every 15 min, commits plan + log) | Claude | Approved |
| P3 | Discord webhook for pushes | Claude | Approved |
| P4 | 4 gear / 3 quick slots, ≤ 25m per item, ~10% cash buffer | Claude | Approved |
| P5 | Retire v1 scheduled task, freeze v1 folder | Claude | Approved |
| P6 | Repo lives outside OneDrive (C:\dev\osrs-flip-v2) | Claude | Approved |

## 2026-09-25: build-time facts and assumptions (please confirm the ⚠ ones)

- **Verified:** a static page can read the wiki API directly. Tested from an unrelated origin: `/latest`, `/5m` and `/timeseries` all readable.
- **Verified:** Flipping Utilities file layout, from the plugin source (`trades[].h.sO[]` offer events, `lastOffers`).
  Timestamp format not yet seen, so the importer accepts epoch s/ms, ISO strings and `{seconds,nanos}`. Confirm against your real file.
- ✅ **Timezone = America/Chicago.** Confirmed by Jason.
- ✅ **Weekend play windows = 06:00–08:00, 10:00–14:00, 16:00–20:00, 21:00–24:00.** Set by Jason (replaces the assumed 08:00–24:00).
  Weekend gaps are now short (2h, 2h, 1h), plus the 6h overnight gap.
- ✅ **Slot budgets** (confirmed by Jason): `gearShareOfStake = 0.75` gives ~16.9m per gear slot and ~7.5m per quick slot on a 100m stake.
  So gear items above ~16.9m aren't recommended yet, even though the per-item cap is 25m. Raise the share or the stake if you want bigger tickets.
- **Initial method parameters** (config.json → `method`, `strongBuy`). These are starting values, not tuned, and are only changed with evidence:
  - bid 0–5% under the live low, chosen to maximize expected profit;
  - sell target = 60th percentile of the last 24h of hourly instant-buy averages;
  - fill and exit odds measured on ~15 days of hourly history;
  - volume participation 20%;
  - items falling faster than 3%/day are excluded.
- **Added during build:** the report shows *model-expected capture* next to real capture.
  Reason: the dry run showed typical exit odds of 50–90%. Because losses count, even a perfectly honest model will often
  expect less than 60% capture. If real capture ≈ model-expected, the predictions are well calibrated and the fix is
  *what* gets recommended. If real capture is well below model-expected, the odds themselves are wrong.

## 2026-09-25: dry run on real prices (Fri 16:00 CDT, 6h gap, ~200-item subset)

- 36 candidates → 4 gear + 10 quick recommendations. 1 excluded as falling.
- The plan's expected profit was ~373k for the session. "If it works" margins summed to ~2.1m.
  Several gear picks were long shots (fill 6–12%).
- Takeaway to test: at 100m, realistic expected profit may be a few hundred k per session. The 2-week test will show
  whether that's the reality.

## Open questions for the first weekly review
1. Is the 60% target right, given model-expected capture? (Keep it, or also track calibration as its own goal.)
2. Should long-shot recommendations (fill < 25%) take slots, or should those slots stay empty?

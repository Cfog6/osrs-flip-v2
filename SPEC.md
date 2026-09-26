# OSRS Flip Assistant v2: Spec

**Status:** APPROVED 2026-09-25 (all proposals P1–P6). Build steps 1–5 implemented; see DECISIONS.md.
**Owner:** Jason (approves) · **Builder:** Claude (proposes)
**Replaces:** `osrs-flip-filter/` (v1). That folder gets frozen as an archive. Nothing is refactored from it.

---

## 1. Purpose

A personal tool that tells me **what to put in my GE slots each session**. My real trades
then flow back in automatically, so we can measure whether the advice works and adjust it.
It is also an experiment in how AI-assisted coding performs when scope is controlled.

## 2. Success criteria (decided up front)

| Metric | Definition | Target |
|---|---|---|
| **Margin capture** (primary) | Σ realized profit ÷ Σ predicted profit, over completed *linked* flips (see §6). Losses and 72h forced exits count. | **≥ 60%** |
| Sample size | Linked, completed flips before any methodology change | ≥ 30 |
| Fill rate | Share of acted-on recommendations whose buy filled within the stated check-back | Reported, not targeted (v2.0) |
| Steady growth | Net GP over the test and worst drawdown on the 100m test stake | Reported |

**Initial test:** 100m stake, 2 weeks, account *HardContract*. At the end we do a blind review and
make a keep / change / stop decision.

## 3. My constraints (the tool must respect these)

- **Slots:** 7 of 8 for flipping. Slot 8 is always mine.
- **Stake:** 100m.
- **Max hold:** 72 hours. After that the tool says "sell at market".
- **Style:** steady growth, gear/big-ticket leaning, plus some quick bulk flips.
- **Play windows:**

| | Sessions | Unattended gaps that follow |
|---|---|---|
| Weekdays | 06:00–07:30, 16:00–19:00, 22:00–24:00 | **8.5h** (work), **3h** (evening), **6h** (overnight) |
| Weekends | Most of the day | Short gaps |

> **Key design consequence:** on weekdays the *gaps between sessions*, not the 4-hour buy
> limit, decide what can fill. Each recommendation is sized for the gap that follows the
> session in which I place it. An offer set at 07:30 has 8.5h to fill; one set at 19:00 has 3h.

## 4. What I see

**One web page, one view: "Session Plan".** Nothing else in v2.0.

For each of my 7 slots:

| Item | Qty | Bid | Sell target | Check back | Type |
|---|---|---|---|---|---|
| e.g. Dragon hunter crossbow | 1 | 24.1m | 25.3m | next session (16:00) | Gear |

- **Top:** stake summary (cash, value held, open positions and how long each has been held).
- **Holding section:** for each item I hold, "list at X" or "72h reached, sell at market".
- **Detail on click only:** price chart with bid/sell lines, predicted margin, fill probability, why it was picked.
- **Push messages:**
  - a short *pre-session digest* 15 min before each play window;
  - an instant alert when a **strong buy** appears inside a play window;
  - no alerts outside play windows.

## 5. How recommendations are made (v2.0 method: deliberately simple)

Data comes only from the OSRS Wiki real-time API (`/mapping`, `/latest`, `/5m`, `/1h`, `/timeseries`).
There is no local price database.

1. **Universe**
   - **Gear:** items priced 1m–25m.
   - **Quick:** items with high enough volume to turn within one gap.
   - **Excluded:** items with no known buy limit, thin markets, and one-off freak prints (live price far from its 1h average).
2. **Bid:** a patient price near recent lows. Never above the live instant-sell price.
3. **Sell target:** a recent high, capped by the last 24–72h. Never a stale high from a falling market.
4. **Fill probability:** from history, how often the price traded through a bid like this within a gap of the same length.
5. **Quantity:** the smallest of the buy limit, 20% of expected volume during the gap, and the slot's GP allocation.
6. **Predicted margin:** (sell target − tax − bid) × qty. Tax is 2%, capped at 5m, none under 50gp, exempt list checked by test.
7. **Rank** by expected profit, which is predicted margin × fill probability, minus a penalty for failing to exit within 72h.
8. **Strong buy:** high fill probability, above a profit threshold, not in a sharp decline, liquid.

Every recommendation is **logged with a timestamp and its prediction** before I see it. The log is append-only.

## 6. Feedback loop

1. **Source:** Flipping Utilities writes `%USERPROFILE%\.runelite\flipping\<account>.json`, saved on logout. It lists every item traded, each with its offer history.
2. **Import:** drag the file onto the page. It is read locally and never uploaded.
3. **Linking:** a trade is *linked* to a recommendation when all of these hold:
   - same item;
   - buy placed after the recommendation, within that session or its following gap;
   - quantity within the recommended amount.

   Unlinked trades are ignored, since they are usually items bought to play.
4. **Completed flip:** the linked buy has been fully sold, or 72h has passed. Leftover stock is marked at the instant-sell price.
5. **Weekly report**, generated on the page:
   - margin capture;
   - fill rate;
   - hold times, split by Gear vs Quick;
   - the 5 worst misses and why;
   - **proposed changes, each citing the evidence.** Jason approves or rejects; nothing changes automatically.

## 7. Scope guardrails (the anti-creep rules)

- v2.0 has **exactly four parts:**
  1. recommendation engine
  2. Session Plan page
  3. notifier
  4. import + weekly report
- Every new idea goes into `BACKLOG.md`, not the code.
- No methodology or parameter change without ≥ 30 linked flips of evidence. Bug fixes are exempt.
- The spec changes before the code does. Each AI proposal and each decision is logged in `DECISIONS.md` (this is also the AI-coding experiment record).
- All money math is covered by tests.
- A blind review runs at the end of the 2-week test.

## 8. Proposals (please approve / change)

| # | Proposal | Why | Alternative |
|---|---|---|---|
| P1 | **TypeScript + Vite/React static page.** The engine is shared with a Node script. Python is dropped. | You know React/Vite. Nothing to install or run locally. The wiki API is callable from the browser (existing static apps do it; re-verified in build step 1). | Keep Python for the engine plus a simple page |
| P2 | **GitHub (public repo) + GitHub Pages + GitHub Actions** running the engine every ~15 min. It commits `recs/latest.json` and the append-only log. | Free and always on, so no more "PC was asleep" gaps. The log becomes a versioned dataset. Flipping Utilities data never leaves your PC. | Private repo with Cloudflare Pages/Workers (another account, still free) |
| P3 | **Discord webhook** to a private server for pushes. | Simplest to set up; works on your phone. | ntfy.sh app |
| P4 | **Slot split: 4 Gear / 3 Quick**, max 25m per item, ~10% cash buffer. | Matches "gear-leaning plus some bulk" and the 100m stake. | 5/2, or let the weekly report decide after 30 flips |
| P5 | **Retire v1:** remove the `OSRS Flip Tool` scheduled task (`.\scripts\register_task.ps1 -Remove`) and freeze the folder as an archive. | Stops background runs; v1 data isn't needed. | Leave it running until v2 is live |
| P6 | **New repo lives outside OneDrive** (e.g. `C:\dev\osrs-flip-v2`), in git from the first commit. | Avoids OneDrive/git file-lock issues. | Keep it in Personal Projects |

## 9. Build order (each step ends with something usable)

1. **Verify inputs.** Confirm the browser can call the wiki API. Inspect your real Flipping Utilities file (copy it into the repo's `private/` folder, which git ignores) to pin down its exact fields.
2. **Engine + tests.** Recommendations and the prediction log; tax and quantity math tested.
3. **Session Plan page**, live on GitHub Pages.
4. **Notifier:** pre-session digest plus strong-buy alerts.
5. **Import + weekly report.** **→ Start the 2-week, 100m test.**
6. **End-of-test blind review** and a keep / change / stop decision.

## 10. Out of scope for v2.0 (goes to BACKLOG)

Strategy tournaments, paper trading, backtests, multiple strategies, the all-items finder,
Excel/CSV exports, auto-tuning, a RuneLite plugin, multiple accounts, sharing with other players.

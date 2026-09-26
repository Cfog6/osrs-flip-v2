# OSRS Flip Assistant (v2)

A personal Grand Exchange assistant for **HardContract**. Every 15 minutes it picks what to put
in 7 GE slots, sized to how long offers will sit before your next session. It pushes the plan to
Discord before each session, and it measures its own predictions against your real trades from
Flipping Utilities. See [SPEC.md](SPEC.md) for the goals and rules.

```
GitHub Actions (every 15 min)            GitHub Pages (your page)            Your PC
  wiki API → engine → data/latest.json  →  Plan tab  (7-slot plan)             RuneLite + Flipping Utilities
                    → data/recs.jsonl   →  Review tab (report)  ←── drag in ──  HardContract.json
                    → Discord digest / strong-buy alerts
```

No server, no database, nothing to leave running on your PC. Your trade file never leaves your browser.

---

## One-time setup (about 20 minutes)

**0. Retire v1.** In PowerShell, from the old `osrs-flip-filter` folder:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_task.ps1 -Remove
```

**1. Move this folder out of OneDrive** (approved P6):
```powershell
New-Item -ItemType Directory -Force C:\dev | Out-Null
Move-Item "$HOME\OneDrive\Documents\Personal Projects\osrs-flip-v2" C:\dev\osrs-flip-v2
cd C:\dev\osrs-flip-v2
```
In future Claude sessions, select `C:\dev\osrs-flip-v2` as the working folder.

**2. Install tools** if you don't have them: [Node.js 22 LTS](https://nodejs.org) and [Git](https://git-scm.com).

**3. Check it works locally:**
```powershell
npm install
npm test          # 21 tests
npm run engine    # builds data/latest.json from live prices (~1 min)
npm run dev       # open the printed localhost URL
```

**4. Create a public GitHub repo** named `osrs-flip-v2` (no README), then:
```powershell
git init
git add .
git commit -m "v2.0: engine, page, notifier, report"
git branch -M main
git remote add origin https://github.com/<you>/osrs-flip-v2.git
git push -u origin main
```

**5. Turn on the page:** repo **Settings → Pages → Source: GitHub Actions**. The `pages` workflow
publishes to `https://<you>.github.io/osrs-flip-v2/`.

**6. Discord pushes:** in your Discord server, **Channel settings → Integrations → Webhooks → New Webhook → Copy URL**.
In GitHub: **Settings → Secrets and variables → Actions → New repository secret**, named `DISCORD_WEBHOOK_URL`.

**7. Start the engine:** **Actions → engine → Run workflow**. After that it runs by itself every 15 minutes.
If it can't push, check **Settings → Actions → General → Workflow permissions → Read and write**.

## Each session

1. The Discord digest arrives ~15 min before 06:00 / 16:00 / 22:00 (weekends: 06:00, 10:00, 16:00, 21:00).
2. Open the page and place the **Bid** offers for your free slots. **Holding** tells you what to list and at what price.
3. A ⭐ strong buy may ping mid-session. Take it only if you have a free slot.

## Each week

1. Log out of RuneLite so Flipping Utilities saves `%USERPROFILE%\.runelite\flipping\HardContract.json`.
2. Page → **Review** → drop the file → **Download weekly report**.
3. Bring the report to a Claude session. Proposed changes go in [DECISIONS.md](DECISIONS.md) and need your approval.
   No methodology changes before 30 linked flips.

## Layout

| Path | What |
|---|---|
| `config.json` | Every tunable number (schedule, slots, thresholds). Changes go through DECISIONS.md. |
| `src/engine/` | Pure logic: tax, schedule, stats, recommend, log, notify, Flipping Utilities parser, report |
| `src/web/` | The page (Plan + Review) |
| `scripts/run-engine.ts` | The scheduled run; `--fixture <dir>` for offline dry runs |
| `data/` | Engine output, committed by the workflow: `latest.json`, append-only `recs.jsonl`, `notify-state.json` |
| `tests/` | Money math, schedule, stats, log, import/report, notifications, page render |

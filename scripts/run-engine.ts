/**
 * Scheduled engine run (GitHub Actions every 15 min, or locally with `npm run engine`).
 *   - fetches prices, builds the plan, appends new recommendations to data/recs.jsonl
 *   - writes data/latest.json
 *   - sends Discord messages if DISCORD_WEBHOOK_URL is set
 *
 * Offline dry run on saved API responses:  npm run engine -- --fixture <dir> [--now 2026-09-25T21:00:00Z] [--out <dir>]
 *   <dir> contains mapping.json, latest.json, 1h.json and timeseries/<id>.json (raw API shapes).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import cfgJson from "../config.json";
import type { Config } from "../src/engine/types";
import { runEngine } from "../src/engine/engine";
import { parseLog } from "../src/engine/log";
import { wikiClient, type WikiClient } from "../src/engine/wiki";
import { decideNotifications, emptyNotifyState, type NotifyState } from "../src/engine/notify";

const cfg = cfgJson as Config;
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const outDir = arg("--out") ?? "data";
const fixture = arg("--fixture");
const nowMs = arg("--now") ? Date.parse(arg("--now")!) : Date.now();
const repo = process.env.GITHUB_REPOSITORY; // "owner/name" on GitHub Actions
const pageUrl = repo ? `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/` : "(page URL appears once hosted)";
const userAgent = `osrs-flip-v2 personal GE assistant - ${repo ? `https://github.com/${repo}` : "local run"}`;

function fixtureClient(dir: string): WikiClient {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const unwrap = (x: any) => (x && x.data !== undefined ? x.data : x);
  const numKeys = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));
  return {
    mapping: async () => unwrap(read("mapping.json")),
    latest: async () => numKeys(unwrap(read("latest.json"))),
    hourly: async () => numKeys(unwrap(read("1h.json"))),
    timeseries: async (id) => {
      const f = join("timeseries", `${id}.json`);
      if (!existsSync(join(dir, f))) throw new Error("not in fixture");
      return unwrap(read(f));
    },
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const logPath = join(outDir, "recs.jsonl");
  const statePath = join(outDir, "notify-state.json");
  const prevLog = existsSync(logPath) ? parseLog(readFileSync(logPath, "utf8")) : [];

  const wiki = fixture ? fixtureClient(fixture) : wikiClient(userAgent);
  const { plan, appended } = await runEngine(wiki, cfg, prevLog, nowMs, (s) => console.log(s));

  if (appended.length) appendFileSync(logPath, appended.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(outDir, "latest.json"), JSON.stringify(plan, null, 1));
  console.log(`plan: ${plan.gear.length} gear, ${plan.quick.length} quick; ${appended.length} new log lines; ` +
    `${plan.stats.excludedFalling} excluded as falling, ${plan.stats.excludedThinHistory} thin history`);

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (webhook && !args.includes("--no-notify")) {
    const state: NotifyState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : emptyNotifyState();
    const { messages, state: next } = decideNotifications(plan, cfg, state, nowMs, pageUrl);
    for (const content of messages) {
      const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!res.ok) console.error(`discord: HTTP ${res.status}`);
    }
    writeFileSync(statePath, JSON.stringify(next));
    console.log(`notifications sent: ${messages.length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

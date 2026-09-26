/** Browser-side data access. The page never writes anywhere except this browser's storage. */
import type { LatestQuote, PlanFile, Recommendation, SeriesPoint } from "../engine/types";
import type { FuOffer } from "../engine/fu";
import { parseLog } from "../engine/log";
import { buildExemptIds } from "../engine/tax";
import { API } from "../engine/wiki";

const store = {
  get<T>(k: string, fallback: T): T {
    try { const v = localStorage.getItem(k); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
  },
  set(k: string, v: unknown): boolean {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Where the engine's output lives: the repo's raw files when hosted on GitHub Pages, ./data/ locally. */
export function dataBase(): string {
  const override = store.get<string>("dataBase", "");
  if (override) return override;
  const { hostname, pathname } = window.location;
  if (hostname.endsWith("github.io")) {
    const owner = hostname.split(".")[0];
    const repo = pathname.split("/").filter(Boolean)[0];
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/data/`;
  }
  return "./data/";
}

const bust = () => `?t=${Math.floor(Date.now() / 60_000)}`;

export async function loadPlan(): Promise<PlanFile> {
  const r = await fetch(dataBase() + "latest.json" + bust());
  if (!r.ok) throw new Error(`No plan yet (HTTP ${r.status}). Has the engine run?`);
  return r.json();
}

export async function loadRecLog(): Promise<Recommendation[]> {
  const r = await fetch(dataBase() + "recs.jsonl" + bust());
  return r.ok ? parseLog(await r.text()) : [];
}

export async function loadLive(): Promise<Record<number, LatestQuote>> {
  const j = await (await fetch(`${API}/latest`)).json();
  return Object.fromEntries(Object.entries(j.data).map(([k, v]) => [Number(k), v as LatestQuote]));
}

export async function loadSeries(id: number): Promise<SeriesPoint[]> {
  return (await (await fetch(`${API}/timeseries?timestep=1h&id=${id}`)).json()).data;
}

/** Tax-exempt item ids, cached for a day (the mapping itself is ~1 MB). */
export async function loadExempt(): Promise<Set<number>> {
  const cached = store.get<{ at: number; ids: number[] } | null>("exempt", null);
  if (cached && Date.now() - cached.at < 86_400_000) return new Set(cached.ids);
  const mapping = await (await fetch(`${API}/mapping`)).json();
  const ids = [...buildExemptIds(mapping)];
  store.set("exempt", { at: Date.now(), ids });
  return new Set(ids);
}

export interface Imported { importedAt: number; fileName: string; offers: FuOffer[] }
export const loadImported = () => store.get<Imported | null>("fu", null);
export const saveImported = (x: Imported) => store.set("fu", x);
export const clearImported = () => store.del("fu");

export const loadTestStart = () => store.get<string>("testStart", "");
export const saveTestStart = (d: string) => store.set("testStart", d);

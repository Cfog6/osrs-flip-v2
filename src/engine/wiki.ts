/** Minimal OSRS Wiki real-time prices client. Works in Node (sets User-Agent) and the browser. */
import type { IntervalAgg, LatestQuote, MappingItem, SeriesPoint } from "./types";

export const API = "https://prices.runescape.wiki/api/v1/osrs";

export interface WikiClient {
  mapping(): Promise<MappingItem[]>;
  latest(): Promise<Record<number, LatestQuote>>;
  hourly(): Promise<Record<number, IntervalAgg>>;
  timeseries(id: number, step?: "5m" | "1h" | "6h" | "24h"): Promise<SeriesPoint[]>;
}

export function wikiClient(userAgent?: string, fetchImpl: typeof fetch = fetch): WikiClient {
  const get = async (path: string) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}/${path}`, userAgent ? { headers: { "User-Agent": userAgent } } : undefined);
      if (res.ok) return res.json();
      if (attempt >= 2 || (res.status < 500 && res.status !== 429)) throw new Error(`wiki ${path}: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  };
  const numKeys = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v])) as Record<number, T>;
  return {
    mapping: () => get("mapping"),
    latest: async () => numKeys((await get("latest")).data),
    hourly: async () => numKeys((await get("1h")).data),
    timeseries: async (id, step = "1h") => (await get(`timeseries?timestep=${step}&id=${id}`)).data,
  };
}

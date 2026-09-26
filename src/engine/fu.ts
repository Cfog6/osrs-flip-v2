/**
 * Parser for Flipping Utilities' account file: %USERPROFILE%\.runelite\flipping\<account>.json
 * Layout (from the plugin source): { trades: [ { id, name, h: { sO: [OfferEvent] } } ], lastOffers: { slot: OfferEvent } }
 * OfferEvent keys: uuid, b (buy), id, cQIT (qty filled), tQIT (offer size), p (pre-tax price each),
 * t (time), s (slot, -1 = added manually), st (state), tradeStartedAt.
 * Each finished trade is stored as ONE event (BOUGHT/SOLD/CANCELLED_*), timed at completion.
 */
export interface FuOffer {
  uuid: string;
  itemId: number;
  name: string;
  isBuy: boolean;
  qty: number;          // filled
  size: number;         // offer size
  price: number;        // pre-tax, per unit
  timeMs: number;       // last update (completion for finished trades)
  startedMs: number | null;
  state: string;
  slot: number;
}

const BUY_STATES = new Set(["BOUGHT", "BUYING", "CANCELLED_BUY"]);

/** Accepts epoch ms/s numbers, ISO strings, or {seconds|epochSecond, nanos} objects. */
export function parseTime(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === "number") return x > 1e12 ? x : x * 1000;
  if (typeof x === "string") { const n = Number(x); if (Number.isFinite(n)) return parseTime(n); const d = Date.parse(x); return Number.isNaN(d) ? null : d; }
  if (typeof x === "object") {
    const o = x as Record<string, number>;
    const s = o.seconds ?? o.epochSecond;
    if (typeof s === "number") return s * 1000 + Math.floor((o.nanos ?? o.nano ?? 0) / 1e6);
  }
  return null;
}

function toOffer(e: any, name: string): FuOffer | null {
  if (!e || typeof e !== "object") return null;
  const itemId = Number(e.id ?? 0);
  const state = String(e.st ?? "");
  if (!itemId || state === "EMPTY") return null;
  const timeMs = parseTime(e.t);
  if (timeMs == null) return null;
  return {
    uuid: String(e.uuid ?? `${itemId}-${timeMs}-${e.s}`),
    itemId, name,
    isBuy: typeof e.b === "boolean" ? e.b : BUY_STATES.has(state),
    qty: Number(e.cQIT ?? 0),
    size: Number(e.tQIT ?? 0),
    price: Number(e.p ?? 0),
    timeMs,
    startedMs: parseTime(e.tradeStartedAt),
    state,
    slot: Number(e.s ?? -1),
  };
}

export function parseFlippingUtilities(json: any): FuOffer[] {
  if (!json || !Array.isArray(json.trades)) throw new Error("This doesn't look like a Flipping Utilities account file (no 'trades' list).");
  const names = new Map<number, string>();
  const byUuid = new Map<string, FuOffer>();
  for (const item of json.trades) {
    const name = String(item?.name ?? item?.id ?? "?");
    names.set(Number(item?.id), name);
    for (const e of item?.h?.sO ?? []) { const o = toOffer(e, name); if (o) byUuid.set(o.uuid, o); }
  }
  for (const e of Object.values(json.lastOffers ?? {})) {
    const o = toOffer(e, names.get(Number((e as any)?.id)) ?? String((e as any)?.id));
    if (o && !byUuid.has(o.uuid)) byUuid.set(o.uuid, o);
  }
  return [...byUuid.values()].sort((a, b) => a.timeMs - b.timeMs);
}

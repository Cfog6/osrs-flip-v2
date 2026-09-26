/**
 * Turns live prices + per-item history into ranked recommendations for gear and quick slots.
 * Two passes: a cheap prefilter on bulk data, then a history-based evaluation of the shortlist.
 */
import type { Config, IntervalAgg, LatestQuote, MappingItem, Recommendation, SlotType } from "./types";
import { geTax, TAX_RATE } from "./tax";
import { type Dense, flipOdds, hoursOfHistory, recentHighPercentile, trendPctPerDay, volumeLastHours } from "./stats";

export interface Candidate {
  item: MappingItem;
  type: SlotType;
  low: number;   // live instant-sell price
  high: number;  // live instant-buy price
  naive: number; // rough ranking value for the prefilter
}

export function allocationPerSlot(cfg: Config, type: SlotType): number {
  const deployable = cfg.stake * (1 - cfg.cashBufferPct);
  const share = type === "gear" ? cfg.gearShareOfStake : 1 - cfg.gearShareOfStake;
  return Math.min(cfg.maxPerItem, Math.floor((deployable * share) / cfg.slots[type]));
}

function typeFor(price: number, cfg: Config): SlotType | null {
  const g = cfg.universe.gear, q = cfg.universe.quick;
  if (price >= g.minPrice && price <= g.maxPrice) return "gear";
  if (price >= q.minPrice && price <= q.maxPrice) return "quick";
  return null;
}

export function prefilter(
  mapping: MappingItem[], latest: Record<number, LatestQuote>, hourly: Record<number, IntervalAgg>,
  exempt: Set<number>, cfg: Config, nowMs: number, gapHours: number,
): Candidate[] {
  const out: Candidate[] = [];
  const nowS = nowMs / 1000;
  const excluded = new Set(cfg.universe.excludeNames.map((n) => n.toLowerCase()));
  for (const item of mapping) {
    if (!item.limit || excluded.has(item.name.toLowerCase())) continue;
    const q = latest[item.id];
    if (!q || !q.high || !q.low || !q.highTime || !q.lowTime) continue;
    const type = typeFor(q.low, cfg);
    if (!type) continue;
    const u = cfg.universe[type];
    // judge freshness by the OLDER side of the quote
    if (nowS - Math.min(q.highTime, q.lowTime) > u.maxQuoteAgeMinutes * 60) continue;
    const h = hourly[item.id];
    const dev = cfg.universe.maxPrintDeviation;
    if (h?.avgLowPrice && Math.abs(q.low - h.avgLowPrice) / h.avgLowPrice > dev) continue;
    if (h?.avgHighPrice && Math.abs(q.high - h.avgHighPrice) / h.avgHighPrice > dev) continue;
    const vol1h = h ? Math.min(h.lowPriceVolume, h.highPriceVolume) : 0;
    if (vol1h * 24 < u.minDailyVolume / 4) continue;
    const net = q.high - geTax(q.high, item.id, exempt) - q.low;
    if (net <= 0) continue;
    const qty = Math.min(item.limit, Math.floor(allocationPerSlot(cfg, type) / q.low), Math.max(1, Math.floor(cfg.method.participation * vol1h * gapHours)));
    if (qty < 1) continue;
    out.push({ item, type, low: q.low, high: q.high, naive: net * qty });
  }
  const pick = (t: SlotType) => out.filter((c) => c.type === t).sort((a, b) => b.naive - a.naive).slice(0, cfg.method.candidatesPerType);
  return [...pick("gear"), ...pick("quick")];
}

export interface EvalContext {
  cfg: Config;
  exempt: Set<number>;
  nowMs: number;
  gapHours: number;
  nextCheckAt: number;
}

export type EvalResult =
  | { ok: true; rec: Omit<Recommendation, "recId" | "ts"> }
  | { ok: false; reason: "thin-history" | "low-volume" | "falling" | "no-sell-target" | "no-profitable-bid" };

export function evaluate(c: Candidate, dn: Dense, ctx: EvalContext): EvalResult {
  const { cfg, exempt } = ctx;
  const m = cfg.method;
  if (hoursOfHistory(dn) < m.minHistoryHours) return { ok: false, reason: "thin-history" };

  const vol24 = volumeLastHours(dn, 24);
  const dailyVolume = vol24.low + vol24.high;
  if (dailyVolume < cfg.universe[c.type].minDailyVolume) return { ok: false, reason: "low-volume" };

  const trend = trendPctPerDay(dn, m.trendLookbackHours);
  if (trend < -m.maxDeclinePctPerDay) return { ok: false, reason: "falling" };

  const sell = recentHighPercentile(dn, m.sellLookbackHours, m.sellPercentile);
  if (sell == null) return { ok: false, reason: "no-sell-target" };
  const sellPrice = Math.round(sell);
  const taxEach = geTax(sellPrice, c.item.id, exempt);
  const taxRate = taxEach === 0 ? 0 : TAX_RATE;
  const alloc = allocationPerSlot(cfg, c.type);
  const expSellersInGap = (vol24.low / 24) * ctx.gapHours; // instant-sellers are who fill a buy offer

  let best: Omit<Recommendation, "recId" | "ts"> | null = null;
  for (const d of m.bidDiscounts) {
    const bid = Math.floor(c.low * (1 - d));
    const marginEach = sellPrice - taxEach - bid;
    if (bid <= 0 || marginEach <= 0) continue;
    const odds = flipOdds(dn, ctx.gapHours, d, sellPrice / bid - 1, cfg.maxHoldHours, taxRate);
    if (odds.nFill < m.minFillSamples || odds.nExit < m.minExitSamples) continue;
    // P7: the sell side needs buyers too. Instant-buyers are who fill a sell offer; you get
    // the same 20% share of them over the time a sell realistically takes (at least one gap,
    // or the historical median time-to-exit if longer, never beyond the max hold).
    const sellWindowH = Math.min(cfg.maxHoldHours, Math.max(ctx.gapHours, odds.medianHoursToExit ?? ctx.gapHours));
    const expBuyersInSellWindow = (vol24.high / 24) * sellWindowH;
    const caps = {
      limit: c.item.limit ?? 0,
      volume: Math.floor(m.participation * expSellersInGap),
      sellVolume: Math.floor(m.participation * expBuyersInSellWindow),
      stake: Math.floor(alloc / bid),
    };
    const qty = Math.min(caps.limit, caps.volume, caps.sellVolume, caps.stake);
    if (qty < 1) continue;
    const predProfit = marginEach * qty;
    if (predProfit < m.minProfitPerSlot[c.type]) continue;
    const lossEach = odds.avgLossRel * bid;
    const expProfit = Math.round(qty * odds.pFill * (odds.pExit * marginEach + (1 - odds.pExit) * lossEach));
    if (best && expProfit <= best.expProfit) continue;
    const capBy = qty === caps.limit ? "buy limit"
      : qty === caps.volume ? "20% of expected sellers (buy side)"
      : qty === caps.sellVolume ? `20% of expected buyers over ~${Math.round(sellWindowH)}h (sell side)`
      : "slot budget";
    const sb = cfg.strongBuy;
    best = {
      itemId: c.item.id, name: c.item.name, type: c.type,
      bid, sell: sellPrice, qty, limit: c.item.limit ?? 0, taxEach,
      predMarginEach: marginEach, predProfit,
      pFill: round3(odds.pFill), pExit: round3(odds.pExit), nFillSamples: odds.nFill, nExitSamples: odds.nExit,
      medianHoursToExit: odds.medianHoursToExit, expProfit,
      gapHours: round3(ctx.gapHours), checkBackAt: ctx.nextCheckAt,
      trendPctPerDay: round3(trend), dailyVolume,
      strong: odds.pFill >= sb.minFillProb && odds.pExit >= sb.minExitProb && expProfit >= sb.minExpectedProfit[c.type] && trend >= -m.maxDeclinePctPerDay / 2,
      reasons: [
        `${d === 0 ? "Bid at the live low" : `Bid ${(d * 100).toFixed(1)}% under the live low`}. Similar bids filled within ${Math.round(ctx.gapHours)}h in ${pct(odds.pFill)} of ${odds.nFill} past windows.`,
        `After filling, the sell target was reached within ${cfg.maxHoldHours}h in ${pct(odds.pExit)} of ${odds.nExit} cases` +
          (odds.medianHoursToExit != null ? ` (median ${odds.medianHoursToExit}h).` : "."),
        `Trend ${trend >= 0 ? "+" : ""}${trend.toFixed(1)}%/day. ${dailyVolume.toLocaleString()} traded in the last 24h. Quantity capped by ${capBy}.`,
      ],
    };
  }
  if (!best) return { ok: false, reason: "no-profitable-bid" };
  if (best.expProfit <= 0) return { ok: false, reason: "no-profitable-bid" };
  return { ok: true, rec: best };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => `${Math.round(x * 100)}%`;

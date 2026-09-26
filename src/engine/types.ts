import type rawConfig from "../../config.json";

export type Config = typeof rawConfig;
export type SlotType = "gear" | "quick";

/** /mapping entry */
export interface MappingItem {
  id: number;
  name: string;
  limit?: number;
  members?: boolean;
  value?: number;
  highalch?: number;
}

/** /latest entry. high = instant-buy price, low = instant-sell price. */
export interface LatestQuote {
  high: number | null;
  highTime: number | null;
  low: number | null;
  lowTime: number | null;
}

/** /1h and /5m entry */
export interface IntervalAgg {
  avgHighPrice: number | null;
  highPriceVolume: number;
  avgLowPrice: number | null;
  lowPriceVolume: number;
}

/** /timeseries point */
export interface SeriesPoint extends IntervalAgg {
  timestamp: number; // unix seconds, start of bucket
}

/** A recommendation exactly as logged (append-only) and shown to the player. */
export interface Recommendation {
  recId: string;
  ts: number;               // unix ms when first logged
  configVersion?: string;   // config.version that produced it (absent on lines logged before 2.1.0)
  itemId: number;
  name: string;
  type: SlotType;
  bid: number;              // place BUY offer at this price
  sell: number;             // place SELL offer at this price
  qty: number;
  limit: number;
  taxEach: number;
  predMarginEach: number;   // sell - tax - bid  (the success metric compares against this)
  predProfit: number;       // predMarginEach * qty
  pFill: number;            // P(buy fills within the gap)
  pExit: number;            // P(sell target reached within maxHoldHours after fill)
  nFillSamples: number;
  nExitSamples: number;
  medianHoursToExit: number | null;
  expProfit: number;        // ranking value: qty * pFill * (pExit*margin + (1-pExit)*expected loss)
  gapHours: number;         // how long the offer sits before the next check-in
  checkBackAt: number;      // unix ms
  trendPctPerDay: number;
  dailyVolume: number;
  strong: boolean;
  reasons: string[];
}

export interface PlanFile {
  generatedAt: number;       // unix ms
  configVersion: string;
  placementAt: number;       // unix ms: now if in a play window, else next window start
  nextCheckAt: number;
  gapHours: number;
  inWindow: boolean;
  gear: Recommendation[];
  quick: Recommendation[];
  stats: { scanned: number; candidates: number; evaluated: number; excludedFalling: number; excludedThinHistory: number };
}

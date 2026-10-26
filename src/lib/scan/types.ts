/**
 * Wire format of the server-side scan cache (background worker → `/api/scan/*` → browser).
 * Field names are short: metric rows are sent for hundreds of coins per update.
 */
import type { TrackedDensity } from '@/lib/densities/detect';
import type { DensityMarket } from '@/lib/densities/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { BarSet } from '@/lib/screener/metrics';

/** Bar sets loaded for a coin, as bits (a metric is computable when all its sets are loaded). */
export const BAR_BITS: Record<BarSet, number> = { k1m: 1, k5m: 2, oi5: 4, oi1h: 8, k1h: 16 };
export const barMask = (sets: readonly BarSet[]): number => sets.reduce((m, s) => m | BAR_BITS[s], 0);

/** One coin of a venue's metric table. */
export interface MetricRow {
  /** Base symbol. */
  s: string;
  /** Last price. */
  p: number;
  /** 24h change (0.012 = +1.2%), null if unknown. */
  c: number | null;
  /** 24h turnover (quote currency). */
  v: number;
  /** Funding rate, null on spot. */
  f: number | null;
  /** Loaded bar sets (BAR_BITS). Bars that can't load (unlisted / unpublished) count as loaded. */
  b: number;
  /** Metric values by key (only the keys asked for). */
  m: Record<string, number | null>;
  /** Direction of directional metrics (1 up, −1 down). */
  d?: Record<string, 1 | -1>;
}

export interface Coverage {
  /** Coins whose bars are all loaded. */
  scanned: number;
  total: number;
  /** Last change (ms). */
  updatedAt: number;
}

export interface MetricsPayload {
  venue: ExchangeId;
  version: number;
  coverage: Coverage;
  rows: MetricRow[];
}

/** Nesting steps the server evaluates (% of price; 0 = off). */
export const NEST_STEPS = [0, 0.05, 0.1, 0.25, 0.5, 1] as const;
export type NestStep = (typeof NEST_STEPS)[number];
export const isNestStep = (v: number): v is NestStep => (NEST_STEPS as readonly number[]).includes(v);
/** Densities below this size ($) or further than this distance (%) are not tracked. */
export const DENSITY_FLOOR = 100_000;
export const DENSITY_RANGE = 12;

export interface ServerDensityCard {
  /** `venue:market:symbol`. */
  key: string;
  venue: ExchangeId;
  market: DensityMarket;
  symbol: string;
  last: number;
  change24h: number | null;
  volume24h: number;
  /** Leveraged token (BTCUP, ETH3L, …). */
  lev: boolean;
  /** Median bucket notional per side (for the "× median" filter). */
  medians: { bid: number; ask: number };
  /** Densities ≥ DENSITY_FLOOR within DENSITY_RANGE, largest first, with server-tracked lifetimes. */
  densities: TrackedDensity[];
  /** Book snapshot time (ms). */
  updatedAt: number;
}

export interface DensityCoverage { venue: ExchangeId; market: DensityMarket; scanned: number; total: number; error?: string }

export interface DensitiesPayload {
  version: number;
  step: NestStep;
  coverage: DensityCoverage[];
  cards: ServerDensityCard[];
}

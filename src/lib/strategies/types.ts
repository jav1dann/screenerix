/** Strategy formations: shared by the server engine, the API and the dashboard. */
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';

export type StrategyId = 'breakout' | 'defense' | 'obRetest' | 'sweepFvg' | 'spikeFade' | 'longContinuationSweep' | 'shortContinuationSweep' | 'shortFakeoutSweep';
export const STRATEGY_IDS: readonly StrategyId[] = ['breakout', 'defense', 'obRetest', 'sweepFvg', 'spikeFade', 'longContinuationSweep', 'shortContinuationSweep', 'shortFakeoutSweep'];
export const isStrategyId = (v: unknown): v is StrategyId => typeof v === 'string' && (STRATEGY_IDS as readonly string[]).includes(v);

export type Stage = 'FORMING' | 'ACTIVE' | 'LATE' | 'INVALIDATED';
export const STAGES: readonly Stage[] = ['FORMING', 'ACTIVE', 'LATE', 'INVALIDATED'];
export type Direction = 'LONG' | 'SHORT';
export type Quality = 'LOW' | 'MID' | 'HIGH';
export const QUALITIES: readonly Quality[] = ['LOW', 'MID', 'HIGH'];

/** What a detector reports for one coin on one pass. */
export interface Candidate {
  strategy: StrategyId;
  /** Candles the setup was found on. */
  tf: Timeframe;
  dir: Direction;
  /** Bar that defines the setup (the level's last touch, the OB / sweep / spike candle). */
  anchorT: number;
  stage: 'FORMING' | 'ACTIVE';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  /** 0–100. */
  score: number;
  /** Bar delta beyond 1σ in the trade's direction. */
  orderFlow: boolean;
  /** Trade direction agrees with the daily trend. */
  dailyAligned: boolean;
  /** Short human description, e.g. "3-touch resistance". */
  note: string;
  /**
   * Strength index ("индекс силы", continuation strategies): 0–100 from the sweep's volume, the
   * reclaim's momentum, lower-timeframe RSI and structure, with the factors behind it. A heuristic,
   * not a back-tested probability. Also the setup's `score`.
   */
  strength?: { value: number; factors: string[] };
}

export interface Formation extends Omit<Candidate, 'stage'> {
  /** `strategy:symbol:dir:anchorT` of the first sighting. */
  id: string;
  venue: ExchangeId;
  symbol: string;
  stage: Stage;
  /** Last price seen by the engine. */
  price: number;
  /** Move from entry to TP2, % (2.5 = 2.5%). */
  potential: number;
  quality: Quality;
  volume24h: number;
  detectedAt: number;
  stageAt: number;
  /** Last pass whose detector still reported it (FORMING setups expire when they stop showing). */
  seenAt: number;
  /** When TP2 was reached. */
  doneAt?: number;
}

export interface StrategyCoverage { venue: ExchangeId; scanned: number; total: number; updatedAt: number }

export interface StrategiesPayload {
  version: number;
  coverage: StrategyCoverage[];
  formations: Formation[];
}

export const qualityOf = (score: number): Quality => (score >= 70 ? 'HIGH' : score >= 40 ? 'MID' : 'LOW');
export const QUALITY_RANK: Record<Quality, number> = { LOW: 0, MID: 1, HIGH: 2 };

/** Signed distance from price to entry in basis points (positive = price still has to travel to entry). */
export const distanceBps = (f: Pick<Formation, 'entry'>, price: number): number => (price > 0 && f.entry > 0 ? (Math.abs(price - f.entry) / f.entry) * 10_000 : Infinity);

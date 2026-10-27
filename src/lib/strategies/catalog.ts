/** The Strategy Pool: the algorithms the engine runs, as the dashboard describes them. */
import type { Timeframe } from '@/lib/market/exchanges';
import type { Direction, Stage, StrategyId } from './types';

export interface StrategyDef {
  id: StrategyId;
  name: string;
  /** Candles the detector runs on (a formation carries the one it was found on). */
  tfs: readonly Timeframe[];
  /** Directions the algorithm trades. */
  dirs: readonly Direction[];
  /** One line for cards and tabs. */
  summary: string;
  /** The Pool's longer description. */
  description: string;
  /** How the levels are placed. */
  levels: string;
  /** Chart timeframe a new workspace starts with ('setup' = each formation's own timeframe). */
  chartTf: Timeframe | 'setup';
}

export const STRATEGIES: readonly StrategyDef[] = [
  {
    id: 'breakout',
    name: 'Level Breakout',
    tfs: ['1h'],
    dirs: ['LONG', 'SHORT'],
    chartTf: '15m',
    summary: 'Hourly close through a 3+ touch level on volume.',
    description: 'Finds support / resistance levels touched at least three times. Forming while price presses within 0.5 ATR of the level; Active once an hourly candle closes through it on 1.5× average volume and holds.',
    levels: 'Entry on the retest of the broken level · SL 1 ATR back inside · TP1 1.5R · TP2 the next level (2–5R) or 3R.',
  },
  {
    id: 'defense',
    name: 'Level Defense 1h',
    tfs: ['1h'],
    dirs: ['LONG', 'SHORT'],
    chartTf: '15m',
    summary: 'Wick through a 3+ touch level, close back — the level holds.',
    description: 'Watches strong levels within 3 ATR of price. Forming while price trades within 0.3% of the level; Active when an hourly candle pierces it with a wick of at least half its range and closes back on the defended side.',
    levels: 'Entry at the level · SL 0.2 ATR beyond the rejection wick · TP1 1.5R · TP2 the opposite level (2–5R) or 3R.',
  },
  {
    id: 'obRetest',
    name: 'Order Block Retest 1h',
    tfs: ['1h'],
    dirs: ['LONG', 'SHORT'],
    chartTf: '15m',
    summary: 'Last opposite candle before a 2+ ATR displacement, retested.',
    description: 'An order block is the last opposite-colour hourly candle before a displacement of at least 2 ATR within three bars that breaks the prior swing. Forming once the block is defined; Active when price trades back into it.',
    levels: 'Entry at the block’s near edge · SL 0.2 ATR beyond the far edge · TP1 1.5R · TP2 the displacement extreme (2–5R) or 3R.',
  },
  {
    id: 'sweepFvg',
    name: 'Sweep + CHoCH + FVG Retest 1h',
    tfs: ['1h'],
    dirs: ['LONG', 'SHORT'],
    chartTf: '15m',
    summary: 'Liquidity sweep, change of character, then the fair-value-gap retest.',
    description: 'A wick takes an untouched swing low (high) and closes back, a later close breaks the last opposite swing (change of character), and the move leaves a three-candle fair-value gap. Forming while waiting for the gap; Active once price returns into it.',
    levels: 'Entry at the middle of the gap · SL 0.1 ATR beyond the sweep wick · TP1 1.5R · TP2 the swing made after the sweep (2–5R) or 3R.',
  },
  {
    id: 'spikeFade',
    name: 'Spike-fade 5m',
    tfs: ['5m'],
    dirs: ['LONG', 'SHORT'],
    chartTf: '1m',
    summary: 'Fade a 3+ ATR five-minute spike on 3× volume.',
    description: 'A five-minute candle with a range of at least 3 ATR (and 3× average volume once closed) is faded against its direction. Forming while the spike candle is still open; Active once it closes and the next candle makes no new extreme.',
    levels: 'Entry at the spike close · SL 0.2 ATR beyond the spike extreme · TP1 half the spike body back · TP2 the spike open.',
  },
  {
    id: 'longContinuationSweep',
    name: 'Long Continuation after Liquidity Sweep',
    tfs: ['1m', '5m', '15m'],
    dirs: ['LONG'],
    chartTf: 'setup',
    summary: 'Bullish impulse, a shallow range, a wick that sweeps its lows, then a close back inside.',
    description: 'Finds a bullish displacement (2–6 mostly green candles, ≥ 2.5 ATR, at least one body ≥ 1 ATR) and the consolidation after it, which must hold the upper part of the move (≤ 62% retrace) for at least three candles. Its lows, especially equal lows, are the sell-side liquidity. Touching or breaking the range low is not a trade: the setup waits for the sweep — a wick under the low — and for price to close back inside the range (the same candle or one of the next three). Forming once the low is swept while price is still outside; Active on the close back inside. Losing the impulse origin, staying outside for more than three candles or closing back under the wick cancels it. Strength index 0–100: sweep volume, the reclaim candle’s momentum, lower-timeframe RSI (oversold at the sweep, turning up), equal lows, a structure shift, the higher-timeframe trend and the impulse; taking the range high first costs 10.',
    levels: 'Entry at the close back inside the range · SL 0.1 ATR below the sweep wick’s low (set only after the return inside) · TP1 the range high (or 1.5R when that is closer) · TP2 the range high + 1.5× the range height.',
  },
  {
    id: 'shortContinuationSweep',
    name: 'Short Continuation after Liquidity Sweep',
    tfs: ['1m', '5m', '15m'],
    dirs: ['SHORT'],
    chartTf: 'setup',
    summary: 'Bearish impulse, a shallow range, a wick that sweeps its highs, then a close back inside.',
    description: 'The long continuation’s mirror. Finds a bearish displacement (2–6 mostly red candles, ≥ 2.5 ATR, at least one body ≥ 1 ATR) and the consolidation after it, holding the lower part of the move (≤ 62% retrace) for at least three candles. Its highs, especially equal highs, are the buy-side liquidity. Touching or breaking the range high is not a trade: the setup waits for the sweep — a wick above the high — and for price to close back inside the range (the same candle or one of the next three). Forming once the high is swept while price is still outside; Active on the close back inside. Losing the impulse origin, staying outside for more than three candles or closing back above the wick cancels it. Strength index as for the long, mirrored (RSI overbought at the sweep, turning down).',
    levels: 'Entry at the close back inside the range · SL 0.1 ATR above the sweep wick’s high (set only after the return inside) · TP1 the range low (or 1.5R when that is closer) · TP2 the range low − 1.5× the range height.',
  },
  {
    id: 'shortFakeoutSweep',
    name: 'Short after Fakeout & Liquidity Sweep',
    tfs: ['1m', '5m', '15m'],
    dirs: ['SHORT'],
    chartTf: 'setup',
    summary: 'Higher lows into resistance, a failed breakout, then a bearish sweep of the new high.',
    description: 'Price compresses with higher lows into a resistance touched at least twice, breaks above it and fails back below (the fakeout), then holds a tight range. Forming once compression, fakeout and range are in place; Active when a candle wicks above the range high and closes back below resistance with a strong bearish body.',
    levels: 'Entry at the bearish candle’s close · SL 0.1 ATR above the fakeout / sweep high · TP1 the range low · TP2 the compression’s origin low.',
  },
];

/** "1h", or "1m · 5m · 15m" for multi-timeframe strategies. */
export const tfLabel = (def: Pick<StrategyDef, 'tfs'>) => def.tfs.join(' · ');
export const isMultiTf = (def: Pick<StrategyDef, 'tfs'>) => def.tfs.length > 1;

export const STRATEGY_BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

/** Stage colours and what each stage means (badges and tooltips). */
export const STAGE_META: Record<Stage, { color: string; label: string; hint: string }> = {
  FORMING: { color: '#E5B931', label: 'Forming', hint: 'The setup is building — the trigger hasn’t fired yet.' },
  ACTIVE: { color: '#30A46C', label: 'Active', hint: 'Triggered: price is at or near the entry.' },
  LATE: { color: '#9B6BFF', label: 'Late', hint: 'Price has already covered half the way to TP1 (or hit a target) — chasing is risky.' },
  INVALIDATED: { color: '#E5484D', label: 'Invalidated', hint: 'Price went through the stop loss; the setup failed.' },
};

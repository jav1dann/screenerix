/**
 * Indicator catalogue: what the Indicator modal lists and how the engine draws each one.
 *
 * `placement`:
 *  - overlay     lines / dots on the price pane
 *  - background  a histogram behind the candles (bottom 20% of the price pane)
 *  - pane        its own sub-pane below the price pane
 *  - priceLines  horizontal price lines on the price pane (Levels, Densities)
 *  - panel       an HTML panel over the price pane (Market Data)
 */
import * as C from './calc';
import type { Bar, Outputs } from './calc';

export type IndicatorGroup = 'popular' | 'main' | 'sub';
export type Placement = 'overlay' | 'background' | 'pane' | 'priceLines' | 'panel';
export type OutputKind = 'line' | 'histogram' | 'dots' | 'area' | 'candle';

export interface OutputDef {
  key: string;
  label: string;
  kind: OutputKind;
  color: string;
  /** Histogram bar colours: by sign, by candle direction, or rising / falling. */
  colorBy?: 'sign' | 'candle' | 'rising';
}
export interface ParamDef { label: string; def: number; min: number; max: number; step?: number }

export interface IndicatorDef {
  id: string;
  /** Short name shown in legends, e.g. "BOLL". */
  name: string;
  /** Full title in the modal, e.g. "BOLL (Bollinger Bands)". */
  title: string;
  description: string;
  group: IndicatorGroup;
  placement: Placement;
  params: readonly ParamDef[];
  outputs: readonly OutputDef[];
  /** Candle-only calculation (absent for indicators fed by external data). */
  compute?: (bars: readonly Bar[], params: readonly number[]) => Outputs;
  /** Data beyond candles. */
  needs?: 'trades' | 'oi' | 'densities' | 'coin';
  /** Fixed value range for the pane's scale (oscillators). */
  range?: [number, number];
  /** Dashed reference lines in the pane (e.g. RSI 70 / 30). */
  guides?: readonly number[];
  /** Value format in the legend and scale. */
  format?: 'price' | 'volume' | 'percent' | 'number' | 'usd';
  /** Listed but not available yet. */
  soon?: boolean;
  /** For Open Interest: the venue ('global' = all venues summed). */
  oiVenue?: string;
}

/** Line colours, in order of a multi-line indicator's outputs. */
export const LINE_COLORS = ['#F5C542', '#5B9DFF', '#B48CFF', '#2FB8C8', '#FF8A4C', '#E5484D'] as const;
const UP = '#30A46C';
const p = (label: string, def: number, min = 1, max = 500, step = 1): ParamDef => ({ label, def, min, max, step });
const lines = (prefix: string, labels: readonly string[]): OutputDef[] =>
  labels.map((label, i) => ({ key: `${prefix}${i}`, label, kind: 'line' as const, color: LINE_COLORS[i % LINE_COLORS.length] }));
const periodsOf = (n: number, defs: readonly number[]) => defs.slice(0, n).map((d, i) => p(`Period ${i + 1}`, d));

const SMA_DEF = [5, 10, 30, 60];
const EMA_DEF = [6, 12, 20];

/** Multi-period lines: output labels follow the current params (e.g. "MA5"). */
export function outputsFor(def: IndicatorDef, params: readonly number[]): OutputDef[] {
  if (!def.outputs.length) return [];
  return def.outputs.map((o) => {
    const m = /^(ma|ema|rsi|bias|wr)(\d+)$/.exec(o.key);
    if (!m || def.id === 'cr') return o;
    const i = Number(m[2]);
    return { ...o, label: `${o.label.replace(/\d+$/, '')}${params[i] ?? ''}` };
  });
}

const OI_VENUES: ReadonlyArray<{ id: string; name: string; soon?: boolean }> = [
  { id: 'global', name: 'Global' },
  { id: 'self', name: 'Chart exchange' },
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
  { id: 'bitget', name: 'Bitget' },
  { id: 'mexc', name: 'MEXC', soon: true },
  { id: 'gate', name: 'Gate.io' },
  { id: 'kucoin', name: 'KuCoin', soon: true },
  { id: 'bingx', name: 'BingX', soon: true },
  { id: 'htx', name: 'HTX', soon: true },
  { id: 'hyperliquid', name: 'Hyperliquid', soon: true },
  { id: 'aster', name: 'AsterDEX', soon: true },
];

export const OI_INDICATORS: readonly IndicatorDef[] = OI_VENUES.map((v) => ({
  id: `oi.${v.id}`,
  name: v.id === 'global' ? 'OI Global' : v.id === 'self' ? 'OI' : `OI ${v.name}`,
  title: `Open Interest · ${v.name}`,
  description: v.id === 'global' ? 'Open interest summed across Binance, Bybit, OKX, Bitget and Gate.io (USD)'
    : v.id === 'self' ? "Open interest on the chart's own exchange (USD)" : `${v.name} perpetual open interest (USD)`,
  group: 'popular',
  placement: 'pane',
  params: [],
  outputs: [{ key: 'oi', label: 'OI', kind: 'candle', color: '#5B9DFF' }],
  needs: 'oi',
  format: 'usd',
  oiVenue: v.id,
  soon: v.soon,
}));

export const INDICATORS: readonly IndicatorDef[] = [
  /* ── Popular ── */
  {
    id: 'volbg', name: 'VOLBG', title: 'VOLBG (Volume on background)', description: 'Volume histogram behind the candles',
    group: 'popular', placement: 'background', params: [], format: 'volume',
    outputs: [{ key: 'vol', label: 'Vol', kind: 'histogram', color: UP, colorBy: 'candle' }],
    compute: (b) => C.vol(b, []),
  },
  {
    id: 'marketData', name: 'Market Data', title: 'Market Data', description: 'Live price, 24h change, range, volume and trades in a corner panel',
    group: 'popular', placement: 'panel', params: [], outputs: [], needs: 'coin',
  },
  {
    id: 'levels', name: 'Levels', title: 'Levels', description: 'Support and resistance from clustered swing highs and lows',
    group: 'popular', placement: 'priceLines', outputs: [],
    params: [p('Pivot wing (bars)', 2, 1, 10), p('Cluster tolerance (%)', 0.3, 0.05, 5, 0.05), p('Levels per side', 3, 1, 10)],
  },
  {
    id: 'densities', name: 'Densities', title: 'Densities', description: 'Large resting orders from the densities scanner, as price lines',
    group: 'popular', placement: 'priceLines', outputs: [], needs: 'densities',
    params: [p('Min size ($K)', 300, 100, 100_000, 50), p('Lines per side', 3, 1, 10)],
  },
  ...OI_INDICATORS,

  /* ── Main (overlay on price) ── */
  { id: 'sma', name: 'SMA', title: 'SMA (Simple Moving Average)', description: 'Simple moving averages of the close', group: 'main', placement: 'overlay', format: 'price', params: periodsOf(4, SMA_DEF), outputs: lines('ma', SMA_DEF.map((d) => `MA${d}`)), compute: C.ma },
  { id: 'ema', name: 'EMA', title: 'EMA (Exponential Moving Average)', description: 'Exponential moving averages of the close', group: 'main', placement: 'overlay', format: 'price', params: periodsOf(3, EMA_DEF), outputs: lines('ema', EMA_DEF.map((d) => `EMA${d}`)), compute: C.ema },
  {
    id: 'boll', name: 'BOLL', title: 'BOLL (Bollinger Bands)', description: 'SMA with bands k standard deviations away', group: 'main', placement: 'overlay', format: 'price',
    params: [p('Period', 20), p('Std dev', 2, 0.5, 5, 0.1)],
    outputs: [{ key: 'up', label: 'UP', kind: 'line', color: LINE_COLORS[0] }, { key: 'mid', label: 'MID', kind: 'line', color: LINE_COLORS[1] }, { key: 'dn', label: 'DN', kind: 'line', color: LINE_COLORS[2] }],
    compute: C.boll,
  },
  {
    id: 'sar', name: 'SAR', title: 'SAR (Parabolic Stop and Reverse)', description: 'Trailing stop dots that flip with the trend', group: 'main', placement: 'overlay', format: 'price',
    params: [p('Start', 0.02, 0.001, 1, 0.001), p('Step', 0.02, 0.001, 1, 0.001), p('Max', 0.2, 0.01, 1, 0.01)],
    outputs: [{ key: 'sar', label: 'SAR', kind: 'dots', color: LINE_COLORS[0] }], compute: C.sar,
  },
  { id: 'bbi', name: 'BBI', title: 'BBI (Bull and Bear Index)', description: 'Average of four moving averages', group: 'main', placement: 'overlay', format: 'price', params: periodsOf(4, [3, 6, 12, 24]), outputs: [{ key: 'bbi', label: 'BBI', kind: 'line', color: LINE_COLORS[0] }], compute: C.bbi },
  { id: 'vwap', name: 'VWAP', title: 'VWAP (Volume-Weighted Average Price)', description: 'Session VWAP, resets 00:00 UTC', group: 'main', placement: 'overlay', format: 'price', params: [], outputs: [{ key: 'vwap', label: 'VWAP', kind: 'line', color: '#2FB8C8' }], compute: C.vwap },

  /* ── Sub (own pane) ── */
  { id: 'ma.sub', name: 'MA', title: 'MA (Moving Average)', description: 'Moving averages in a separate pane', group: 'sub', placement: 'pane', format: 'price', params: periodsOf(4, SMA_DEF), outputs: lines('ma', SMA_DEF.map((d) => `MA${d}`)), compute: C.ma },
  { id: 'ema.sub', name: 'EMA', title: 'EMA (Exponential Moving Average)', description: 'Exponential moving averages in a separate pane', group: 'sub', placement: 'pane', format: 'price', params: periodsOf(3, EMA_DEF), outputs: lines('ema', EMA_DEF.map((d) => `EMA${d}`)), compute: C.ema },
  {
    id: 'macd', name: 'MACD', title: 'MACD (Moving Average Convergence Divergence)', description: 'DIF, DEA and histogram', group: 'sub', placement: 'pane', format: 'number',
    params: [p('Fast', 12), p('Slow', 26), p('Signal', 9)],
    outputs: [{ key: 'hist', label: 'MACD', kind: 'histogram', color: UP, colorBy: 'sign' }, { key: 'dif', label: 'DIF', kind: 'line', color: LINE_COLORS[1] }, { key: 'dea', label: 'DEA', kind: 'line', color: LINE_COLORS[0] }],
    compute: C.macd,
  },
  {
    id: 'kdj', name: 'KDJ', title: 'KDJ (Stochastic)', description: 'Stochastic K, D and J lines', group: 'sub', placement: 'pane', format: 'number', guides: [80, 20],
    params: [p('Period', 9), p('K smoothing', 3), p('D smoothing', 3)],
    outputs: [{ key: 'k', label: 'K', kind: 'line', color: LINE_COLORS[0] }, { key: 'd', label: 'D', kind: 'line', color: LINE_COLORS[1] }, { key: 'j', label: 'J', kind: 'line', color: LINE_COLORS[2] }],
    compute: C.kdj,
  },
  { id: 'rsi', name: 'RSI', title: 'RSI (Relative Strength Index)', description: "Wilder's RSI", group: 'sub', placement: 'pane', format: 'number', range: [0, 100], guides: [70, 30], params: periodsOf(3, [6, 12, 24]), outputs: lines('rsi', ['RSI6', 'RSI12', 'RSI24']), compute: C.rsi },
  { id: 'bias', name: 'BIAS', title: 'BIAS (Bias Ratio)', description: 'Distance of the close from its moving average, %', group: 'sub', placement: 'pane', format: 'percent', guides: [0], params: periodsOf(3, [6, 12, 24]), outputs: lines('bias', ['BIAS6', 'BIAS12', 'BIAS24']), compute: C.bias },
  {
    id: 'brar', name: 'BRAR', title: 'BRAR (Sentiment Indicator)', description: 'Buying vs selling pressure (BR) and popularity (AR)', group: 'sub', placement: 'pane', format: 'number', guides: [100],
    params: [p('Period', 26)], outputs: [{ key: 'br', label: 'BR', kind: 'line', color: LINE_COLORS[0] }, { key: 'ar', label: 'AR', kind: 'line', color: LINE_COLORS[1] }], compute: C.brar,
  },
  {
    id: 'dmi', name: 'DMI', title: 'DMI (Directional Movement Index)', description: '+DI, −DI, ADX and ADXR', group: 'sub', placement: 'pane', format: 'number',
    params: [p('Period', 14), p('ADX period', 6)],
    outputs: [{ key: 'pdi', label: 'PDI', kind: 'line', color: LINE_COLORS[0] }, { key: 'mdi', label: 'MDI', kind: 'line', color: LINE_COLORS[1] }, { key: 'adx', label: 'ADX', kind: 'line', color: LINE_COLORS[2] }, { key: 'adxr', label: 'ADXR', kind: 'line', color: LINE_COLORS[3] }],
    compute: C.dmi,
  },
  {
    id: 'cr', name: 'CR', title: 'CR (Energy Indicator)', description: 'Buying vs selling energy around the prior midpoint, with shifted MAs', group: 'sub', placement: 'pane', format: 'number',
    params: [p('Period', 26), p('MA 1', 10), p('MA 2', 20), p('MA 3', 40), p('MA 4', 60)],
    outputs: [{ key: 'cr', label: 'CR', kind: 'line', color: LINE_COLORS[0] }, ...lines('ma', ['MA1', 'MA2', 'MA3', 'MA4']).map((o, i) => ({ ...o, color: LINE_COLORS[i + 1] }))],
    compute: C.cr,
  },
  {
    id: 'psy', name: 'PSY', title: 'PSY (Psychological Line)', description: 'Share of up closes, %', group: 'sub', placement: 'pane', format: 'number', range: [0, 100], guides: [75, 25],
    params: [p('Period', 12), p('MA', 6)], outputs: [{ key: 'psy', label: 'PSY', kind: 'line', color: LINE_COLORS[0] }, { key: 'maPsy', label: 'MAPSY', kind: 'line', color: LINE_COLORS[1] }], compute: C.psy,
  },
  {
    id: 'dma', name: 'DMA', title: 'DMA (Different of Moving Average)', description: 'Short MA minus long MA, and its average', group: 'sub', placement: 'pane', format: 'number', guides: [0],
    params: [p('Short', 10), p('Long', 50), p('MA', 10)], outputs: [{ key: 'dif', label: 'DIF', kind: 'line', color: LINE_COLORS[0] }, { key: 'ama', label: 'AMA', kind: 'line', color: LINE_COLORS[1] }], compute: C.dma,
  },
  {
    id: 'trix', name: 'TRIX', title: 'TRIX (Triple Exponentially Smoothed Average)', description: 'Rate of change of a triple EMA, %', group: 'sub', placement: 'pane', format: 'number', guides: [0],
    params: [p('Period', 12), p('MA', 9)], outputs: [{ key: 'trix', label: 'TRIX', kind: 'line', color: LINE_COLORS[0] }, { key: 'maTrix', label: 'MATRIX', kind: 'line', color: LINE_COLORS[1] }], compute: C.trix,
  },
  {
    id: 'obv', name: 'OBV', title: 'OBV (On Balance Volume)', description: 'Cumulative volume signed by close direction', group: 'sub', placement: 'pane', format: 'volume',
    params: [p('MA', 30)], outputs: [{ key: 'obv', label: 'OBV', kind: 'line', color: LINE_COLORS[0] }, { key: 'maObv', label: 'MAOBV', kind: 'line', color: LINE_COLORS[1] }], compute: C.obv,
  },
  {
    id: 'vr', name: 'VR', title: 'VR (Volume Ratio)', description: 'Up-bar vs down-bar volume, %', group: 'sub', placement: 'pane', format: 'number', guides: [100],
    params: [p('Period', 26), p('MA', 6)], outputs: [{ key: 'vr', label: 'VR', kind: 'line', color: LINE_COLORS[0] }, { key: 'maVr', label: 'MAVR', kind: 'line', color: LINE_COLORS[1] }], compute: C.vr,
  },
  { id: 'wr', name: 'WR', title: 'WR (Williams %R)', description: 'Close within the high–low range, −100 … 0', group: 'sub', placement: 'pane', format: 'number', range: [-100, 0], guides: [-20, -80], params: periodsOf(3, [6, 10, 14]), outputs: lines('wr', ['WR6', 'WR10', 'WR14']), compute: C.wr },
  {
    id: 'mtm', name: 'MTM', title: 'MTM (Momentum)', description: 'Close minus the close n bars ago', group: 'sub', placement: 'pane', format: 'price', guides: [0],
    params: [p('Period', 12), p('MA', 6)], outputs: [{ key: 'mtm', label: 'MTM', kind: 'line', color: LINE_COLORS[0] }, { key: 'maMtm', label: 'MAMTM', kind: 'line', color: LINE_COLORS[1] }], compute: C.mtm,
  },
  {
    id: 'emv', name: 'EMV', title: 'EMV (Ease of Movement Value)', description: 'Price movement relative to volume', group: 'sub', placement: 'pane', format: 'number', guides: [0],
    params: [p('Period', 14), p('MA', 9)], outputs: [{ key: 'emv', label: 'EMV', kind: 'line', color: LINE_COLORS[0] }, { key: 'maEmv', label: 'MAEMV', kind: 'line', color: LINE_COLORS[1] }], compute: C.emv,
  },
  {
    id: 'roc', name: 'ROC', title: 'ROC (Rate of Change)', description: 'Change vs n bars ago, %', group: 'sub', placement: 'pane', format: 'percent', guides: [0],
    params: [p('Period', 12), p('MA', 6)], outputs: [{ key: 'roc', label: 'ROC', kind: 'line', color: LINE_COLORS[0] }, { key: 'maRoc', label: 'MAROC', kind: 'line', color: LINE_COLORS[1] }], compute: C.roc,
  },
  {
    id: 'cvd', name: 'CVD', title: 'CVD (Cumulative Volume Delta)', group: 'sub', placement: 'pane', format: 'volume', params: [],
    description: 'Running total of taker buy − sell volume, as candles. Exact where the venue publishes the taker split (Binance) or candles are built from trades; otherwise estimated from each candle',
    outputs: [{ key: 'cvd', label: 'CVD', kind: 'candle', color: UP }], compute: C.cvd,
  },
  { id: 'pvt', name: 'PVT', title: 'PVT (Price and Volume Trend)', description: 'Cumulative volume weighted by % price change', group: 'sub', placement: 'pane', format: 'volume', params: [], outputs: [{ key: 'pvt', label: 'PVT', kind: 'line', color: LINE_COLORS[0] }], compute: C.pvt },
  {
    id: 'ao', name: 'AO', title: 'AO (Awesome Oscillator)', description: 'Fast minus slow SMA of the median price', group: 'sub', placement: 'pane', format: 'price',
    params: [p('Fast', 5), p('Slow', 34)], outputs: [{ key: 'ao', label: 'AO', kind: 'histogram', color: UP, colorBy: 'rising' }], compute: C.ao,
  },
  {
    id: 'trades', name: 'Trades', title: 'Trades', description: 'Number of trades per candle (venues that publish it)', group: 'sub', placement: 'pane', format: 'number', needs: 'trades',
    params: [p('MA', 20)], outputs: [{ key: 'trades', label: 'Trades', kind: 'histogram', color: '#5B9DFF' }, { key: 'maTrades', label: 'MA', kind: 'line', color: LINE_COLORS[0] }], compute: C.trades,
  },
  { id: 'tradersProfit', name: 'Trades by Trader Make Money', title: 'Trades by Trader Make Money', description: 'Coming soon', group: 'sub', placement: 'pane', params: [], outputs: [], soon: true },
  { id: 'natr', name: 'NATR', title: 'NATR (Normalized Average True Range)', description: 'Average true range as % of the close', group: 'sub', placement: 'pane', format: 'percent', params: [p('Period', 14)], outputs: [{ key: 'natr', label: 'NATR', kind: 'line', color: LINE_COLORS[0] }], compute: C.natr },
  {
    id: 'vol', name: 'VOL', title: 'VOL (Volume)', description: 'Volume with moving averages', group: 'sub', placement: 'pane', format: 'volume',
    params: periodsOf(2, [5, 10]), outputs: [{ key: 'vol', label: 'VOL', kind: 'histogram', color: UP, colorBy: 'candle' }, ...lines('ma', ['MA5', 'MA10'])], compute: C.vol,
  },
];

export const INDICATOR_BY_ID: ReadonlyMap<string, IndicatorDef> = new Map(INDICATORS.map((d) => [d.id, d]));
export const defaultParams = (def: IndicatorDef): number[] => def.params.map((x) => x.def);

export const GROUP_TITLE: Record<IndicatorGroup, string> = {
  popular: 'Popular Indicators',
  main: 'Main Indicators',
  sub: 'Sub Indicators',
};

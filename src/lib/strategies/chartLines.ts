/** Entry / SL / TP1 / TP2 levels for a formation on any chart (cards and the expanded chart). */
import { LineSeries, LineStyle } from 'lightweight-charts';
import type { AutoscaleInfo, CreatePriceLineOptions, IChartApi, IPriceLine, ISeriesApi, LineWidth, UTCTimestamp } from 'lightweight-charts';
import type { Direction } from './types';

export interface TradeLevels {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  dir: Direction;
  /** Open time (ms) of the candle the formation originated on: levels are drawn from there. Absent: full-width lines. */
  anchorT?: number;
  /** Which lines to draw and whether they carry their name on the axis (Workspace Settings → Levels). */
  show?: { entry?: boolean; sl?: boolean; tp1?: boolean; tp2?: boolean; labels?: boolean };
}

export const LEVEL_COLORS = { entry: '#3E8BFF', sl: '#E5484D', tp1: '#30A46C', tp2: '#30A46C' } as const;
const LEVEL_TITLES = { entry: 'Entry', sl: 'SL', tp1: 'TP1', tp2: 'TP2' } as const;

export function tradeLineOptions(t: TradeLevels): CreatePriceLineOptions[] {
  const show = t.show ?? {};
  const out: CreatePriceLineOptions[] = [];
  for (const k of ['entry', 'sl', 'tp1', 'tp2'] as const) {
    if (show[k] === false || !(t[k] > 0)) continue;
    out.push({
      price: t[k],
      color: LEVEL_COLORS[k],
      lineWidth: k === 'entry' ? 2 : 1,
      lineStyle: k === 'entry' ? LineStyle.Solid : k === 'tp2' ? LineStyle.LargeDashed : LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: LEVEL_COLORS[k],
      axisLabelTextColor: '#0B0C0E',
      title: show.labels === false ? '' : LEVEL_TITLES[k],
    });
  }
  return out;
}

/** Autoscale that keeps the drawn levels on screen. */
export function withLevels(base: AutoscaleInfo | null, prices: readonly number[]): AutoscaleInfo | null {
  if (!prices.length) return base;
  const lo = Math.min(...prices), hi = Math.max(...prices);
  if (!base?.priceRange) return { priceRange: { minValue: lo, maxValue: hi } };
  return { ...base, priceRange: { minValue: Math.min(base.priceRange.minValue, lo), maxValue: Math.max(base.priceRange.maxValue, hi) } };
}

/**
 * Start of the level segments: the open time of the loaded candle containing `anchorT`
 * (clamped to the first loaded candle), so the segment begins exactly on the origin bar.
 */
export function segmentStart(anchorT: number, bars: readonly { t: number }[]): number | null {
  if (!bars.length) return null;
  if (anchorT <= bars[0].t) return bars[0].t;
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= anchorT) lo = mid; else hi = mid - 1;
  }
  return bars[lo].t;
}

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * Draws a formation's levels on a candle series. With `anchorT`, each level is a
 * segment from the origin candle to the last candle (a two-point line series) and the
 * price line keeps only its axis label; without it, levels are full-width price lines.
 */
export class TradeLevelLayer {
  private lines: IPriceLine[] = [];
  private segs: Array<{ s: ISeriesApi<'Line'>; price: number }> = [];
  private levels: TradeLevels | null = null;
  private span = '';
  /** Prices of the drawn levels (for `withLevels`). */
  prices: number[] = [];

  constructor(private chart: IChartApi, private candles: ISeriesApi<'Candlestick'>) {}

  /** Replace the drawn levels. Returns the drawn titles (for test hooks). */
  set(levels: TradeLevels | null, bars: readonly { t: number }[]): string[] {
    this.clear();
    this.levels = levels;
    const opts = levels ? tradeLineOptions(levels) : [];
    const seg = levels?.anchorT !== undefined;
    this.lines = opts.map((o) => this.candles.createPriceLine(seg ? { ...o, lineVisible: false } : o));
    if (seg) {
      this.segs = opts.map((o) => ({
        price: o.price,
        s: this.chart.addSeries(LineSeries, {
          color: o.color, lineWidth: (o.lineWidth ?? 1) as LineWidth, lineStyle: o.lineStyle,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: false,
          // Levels follow the candle scale; they mustn't stretch it on their own (withLevels does).
          autoscaleInfoProvider: () => null,
        }, 0),
      }));
    }
    this.prices = opts.map((o) => o.price);
    this.update(bars);
    return opts.map((o) => o.title || '·');
  }

  /** Re-anchor the segments to the loaded candles (call on new / reset data). */
  update(bars: readonly { t: number }[]): void {
    const a = this.levels?.anchorT;
    if (a === undefined || !this.segs.length) return;
    const start = segmentStart(a, bars);
    const end = bars[bars.length - 1]?.t;
    const key = `${start}:${end}`;
    if (start === null || end === undefined || key === this.span) return;
    this.span = key;
    for (const { s, price } of this.segs) {
      s.setData(start === end ? [{ time: sec(start), value: price }] : [{ time: sec(start), value: price }, { time: sec(end), value: price }]);
    }
  }

  /** The segment's first candle (ms), or null when levels are full-width / absent. */
  startTime(): number | null {
    const k = this.span.split(':')[0];
    return this.segs.length && k ? Number(k) : null;
  }

  clear(): void {
    for (const l of this.lines) { try { this.candles.removePriceLine(l); } catch { /* chart removed */ } }
    for (const { s } of this.segs) { try { this.chart.removeSeries(s); } catch { /* chart removed */ } }
    this.lines = [];
    this.segs = [];
    this.prices = [];
    this.span = '';
  }
}

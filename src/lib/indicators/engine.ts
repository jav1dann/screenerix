/**
 * Indicator rendering engine for one lightweight-charts instance.
 *
 * `sync(active)` (re)builds series and sub-panes when the selection changes; `setBars`
 * recomputes values: a full update replaces each series' data, a live tick pushes only
 * the last point (callers batch ticks to one per animation frame). External data —
 * open interest, densities — is subscribed here and released on `dispose()`.
 */
import { AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi, SeriesType, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { MarketType } from '@/lib/alerts/alertStore';
import { supportsDensity } from '@/lib/densities/types';
import { fmtPrice, fmtUsd } from '@/lib/format';
import { ADAPTERS, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ChartTimeframe, ExchangeId, OiPoint, RawCandle } from '@/lib/market/exchanges';
import { getOiStream } from '@/lib/market/oiStream';
import type { OiStream } from '@/lib/market/oiStream';
import { densitySource } from '@/lib/scan/client';
import { levels as findLevels, ohlcKeys } from './calc';
import type { Series } from './math';
import { INDICATOR_BY_ID, outputsFor } from './registry';
import type { IndicatorDef, OutputDef } from './registry';
import type { ActiveIndicator } from './store';

export interface LayerContext {
  /** Null for synthetic series (ratio charts): no OI, densities or market data. */
  exchange: ExchangeId | null;
  market: MarketType;
  symbol: string | null;
  tf: ChartTimeframe;
}

/** An external price level (e.g. a live order-book wall) drawn by the Densities indicator. */
export interface LiveLevel { price: number; side: 'bid' | 'ask'; notional: number }

export interface LayerEntry {
  inst: ActiveIndicator;
  def: IndicatorDef;
  outputs: OutputDef[];
  /** Pane the indicator draws in; null when it isn't drawn (panel, or over the card's pane budget). */
  pane: number | null;
  series: Map<string, ISeriesApi<SeriesType>>;
  /** Latest value per output (legend when the crosshair is idle). */
  last: Record<string, number | null>;
  /** Why the indicator shows no data here, if so. */
  note: string | null;
  /** Candle outputs: the live bar's intrabar high / low seen so far (values only arrive as closes). */
  live?: Record<string, { t: number; h: number; l: number }>;
}

/** Venues with futures open interest (the Global OI sum). */
export const OI_EXCHANGES: readonly ExchangeId[] = ['binance', 'bybit', 'okx', 'bitget', 'gate'];
const TRADE_COUNT_VENUES: ReadonlySet<ExchangeId> = new Set(['binance']);
const DOWN = '#E5484D';
const UP = '#30A46C';
const UP_A = 'rgba(48,164,108,0.45)';
const DOWN_A = 'rgba(229,72,77,0.45)';
const GUIDE = 'rgba(139,141,152,0.45)';
const T = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function formatValue(def: IndicatorDef, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  switch (def.format) {
    case 'price': return fmtPrice(v);
    case 'usd': return fmtUsd(Math.abs(v));
    case 'percent': return `${v.toFixed(2)}%`;
    case 'volume': {
      const a = Math.abs(v);
      const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(2)}K` : a.toFixed(a < 10 ? 2 : 0);
      return v < 0 ? `-${s}` : s;
    }
    default: return Math.abs(v) >= 1e4 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  }
}

export interface OiOhlc { o: Series; h: Series; l: Series; c: Series }

/**
 * OI samples as candles on the chart's bars (base units). Close = the last sample up to the
 * bar's end (step-held across bars without one); open = the previous bar's close (the
 * first sample when there's none); high / low = extremes of the open, close and the
 * samples inside the bar. Coarser history (5m samples on a 1m chart) gives flat candles
 * between samples.
 */
export function holdOiOhlc(bars: readonly { t: number }[], pts: readonly OiPoint[], span: number): OiOhlc {
  const o: Series = [], h: Series = [], l: Series = [], c: Series = [];
  let j = 0;
  let cur: number | null = null;
  for (const b of bars) {
    // The first candle with data opens at its first sample.
    let open = cur;
    let hi = open ?? -Infinity, lo = open ?? Infinity;
    while (j < pts.length && pts[j].t <= b.t + span) {
      cur = pts[j++].oi;
      open ??= cur;
      hi = Math.max(hi, cur);
      lo = Math.min(lo, cur);
    }
    if (cur === null || open === null) { o.push(null); h.push(null); l.push(null); c.push(null); continue; }
    o.push(open);
    c.push(cur);
    h.push(Math.max(hi, cur));
    l.push(Math.min(lo, cur));
  }
  return { o, h, l, c };
}

/** Why an indicator can't show data in this window (null when it can). */
export function unavailableReason(def: IndicatorDef, ctx: Pick<LayerContext, 'exchange' | 'market'>): string | null {
  const { exchange, market } = ctx;
  if (def.soon) return 'Coming soon';
  if (def.needs === 'trades' && (!exchange || !TRADE_COUNT_VENUES.has(exchange))) return `${exchange ? ADAPTERS[exchange].name : 'This chart'} doesn't publish trade counts`;
  if ((def.needs === 'oi' || def.needs === 'densities' || def.needs === 'coin') && !exchange) return 'Not available for a spread';
  if (def.needs === 'oi' && def.oiVenue === 'self' && exchange && ADAPTERS[exchange].market !== 'perp') return `${ADAPTERS[exchange].name} spot has no open interest`;
  if (def.needs === 'densities' && exchange && !supportsDensity(exchange, market)) return `No densities for ${ADAPTERS[exchange].name} ${market}`;
  return null;
}

export interface LayerOptions {
  /** How many sub-panes fit (cards cap this by height). */
  maxPanes: () => number;
  /** Price-pane stretch relative to one sub-pane. */
  mainStretch?: number;
}

export class IndicatorLayer {
  private entries: LayerEntry[] = [];
  private active: ActiveIndicator[] = [];
  private bars: readonly RawCandle[] = [];
  private oi = new Map<ExchangeId, { key: string; stream: OiStream; release: () => void; off: () => void }>();
  private linesFor = 0;
  private dens: { off: () => void; key: string; get: () => LiveLevel[] } | null = null;
  private liveLevels: readonly LiveLevel[] | null = null;
  /** Data that turned out to be missing for this coin (e.g. not listed on that venue), by indicator id. */
  private missing = new Map<string, string>();
  private priceLines: IPriceLine[] = [];
  private listeners = new Set<(kind: 'structure' | 'values') => void>();
  private disposed = false;
  /** Sub-pane indicators that didn't fit. */
  overflow = 0;

  constructor(private chart: IChartApi, private candles: ISeriesApi<'Candlestick'>, private ctx: LayerContext, private opts: LayerOptions) {}

  /** 'structure': entries / panes changed (legends re-render); 'values': new last values (legends patch text). */
  onChange(l: (kind: 'structure' | 'values') => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit(kind: 'structure' | 'values') { this.listeners.forEach((l) => l(kind)); }
  getEntries(): readonly LayerEntry[] { return this.entries; }
  getChart(): IChartApi { return this.chart; }

  setContext(ctx: LayerContext): void {
    const same = ctx.exchange === this.ctx.exchange && ctx.market === this.ctx.market && ctx.symbol === this.ctx.symbol && ctx.tf === this.ctx.tf;
    this.ctx = ctx;
    if (!same) { this.missing.clear(); this.rebuild(); }
  }

  /** Live order-book walls (Review) take precedence over the scanner's densities. */
  setLiveLevels(levels: readonly LiveLevel[] | null): void {
    this.liveLevels = levels;
    this.drawPriceLines();
  }

  sync(active: readonly ActiveIndicator[]): void {
    const prev = this.active;
    this.active = [...active];
    const structural = prev.length !== active.length || prev.some((p, i) => p.uid !== active[i].uid || p.id !== active[i].id || p.visible !== active[i].visible);
    if (structural) { this.rebuild(); return; }
    // Params only: same series, new values (labels follow the params).
    for (const e of this.entries) {
      const inst = this.active.find((a) => a.uid === e.inst.uid);
      if (inst) { e.inst = inst; e.outputs = outputsFor(e.def, inst.params); }
    }
    this.syncExternal();
    this.refresh(true);
    this.emit('structure');
  }

  /** Re-check the pane budget (host resized). */
  relayout(): void {
    const subs = this.active.filter((a) => INDICATOR_BY_ID.get(a.id)?.placement === 'pane').length;
    const budget = this.opts.maxPanes();
    const drawn = this.entries.filter((e) => e.def.placement === 'pane' && e.pane !== null).length;
    if (Math.min(subs, budget) !== drawn) this.rebuild();
  }

  setBars(bars: readonly RawCandle[], full: boolean): void {
    this.bars = bars;
    this.refresh(full);
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
    this.oi.forEach((o) => { o.off(); o.release(); });
    this.oi.clear();
    this.dens?.off();
    this.dens = null;
    this.listeners.clear();
  }

  /* ── Structure ── */

  private teardown(): void {
    for (const e of this.entries) for (const s of e.series.values()) { try { this.chart.removeSeries(s); } catch { /* chart already removed */ } }
    this.entries = [];
    this.priceLines.forEach((l) => { try { this.candles.removePriceLine(l); } catch { /* gone */ } });
    this.priceLines = [];
    try { while (this.chart.panes().length > 1) this.chart.removePane(this.chart.panes().length - 1); } catch { /* chart removed */ }
  }

  private rebuild(): void {
    if (this.disposed) return;
    this.teardown();
    const budget = this.opts.maxPanes();
    let pane = 1;
    let subs = 0;
    this.overflow = 0;
    for (const inst of this.active) {
      const def = INDICATOR_BY_ID.get(inst.id);
      if (!def || def.soon) continue;
      const entry: LayerEntry = { inst, def, outputs: outputsFor(def, inst.params), pane: null, series: new Map(), last: {}, note: this.noteFor(def) };
      // Nothing to draw here (venue lacks the data): no pane, the legend shows why.
      if (entry.note && def.placement === 'pane') { this.entries.push(entry); continue; }
      if (def.placement === 'pane') {
        if (subs >= budget) { this.overflow++; this.entries.push(entry); continue; }
        subs++;
        entry.pane = pane++;
      } else if (def.placement !== 'panel') {
        entry.pane = 0;
      }
      if (entry.pane !== null && (def.placement === 'overlay' || def.placement === 'background' || def.placement === 'pane')) this.createSeries(entry);
      this.entries.push(entry);
    }
    const panes = this.chart.panes();
    panes[0]?.setStretchFactor(subs ? (this.opts.mainStretch ?? 3) : 1);
    for (const e of this.entries) if (e.def.placement === 'pane' && e.pane !== null) panes[e.pane]?.setStretchFactor(e.inst.visible ? 1 : 0.18);
    this.syncExternal();
    this.refresh(true);
    this.emit('structure');
  }

  private noteFor(def: IndicatorDef): string | null {
    return unavailableReason(def, this.ctx) ?? this.missing.get(def.id) ?? null;
  }

  private createSeries(e: LayerEntry): void {
    const { def, inst } = e;
    const pane = e.pane as number;
    const visible = inst.visible;
    const fmt = { type: 'custom' as const, formatter: (v: number) => formatValue(def, v), minMove: def.format === 'price' ? 0.00000001 : 0.0001 };
    const autoscale = def.range ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: def.range![0], maxValue: def.range![1] } }) } : {};
    e.outputs.forEach((o, i) => {
      const common = { priceLineVisible: false, lastValueVisible: pane > 0 && i === 0, visible, title: '', priceFormat: fmt, ...autoscale };
      let s: ISeriesApi<SeriesType>;
      if (o.kind === 'histogram') {
        s = this.chart.addSeries(HistogramSeries, { ...common, color: o.color, ...(def.placement === 'background' ? { priceScaleId: 'ind-bg', lastValueVisible: false } : {}) }, pane);
        if (def.placement === 'background') s.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      } else if (o.kind === 'candle') {
        s = this.chart.addSeries(CandlestickSeries, {
          ...common, upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
        }, pane);
      } else if (o.kind === 'area') {
        s = this.chart.addSeries(AreaSeries, { ...common, lineColor: o.color, topColor: `${o.color}47`, bottomColor: `${o.color}05`, lineWidth: 2, crosshairMarkerVisible: false }, pane);
      } else {
        s = this.chart.addSeries(LineSeries, {
          ...common, color: o.color, lineWidth: 1, crosshairMarkerVisible: false,
          ...(o.kind === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 } : {}),
          ...(pane === 0 ? { lastValueVisible: false } : {}),
        }, pane);
      }
      if (i === 0 && pane > 0) {
        for (const g of def.guides ?? []) s.createPriceLine({ price: g, color: GUIDE, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      }
      e.series.set(o.key, s);
    });
  }

  /** Subscribe / release OI streams and the densities feed the active set needs. */
  private syncExternal(): void {
    const { exchange, symbol, tf } = this.ctx;
    const want = new Set<ExchangeId>();
    if (exchange && symbol) {
      for (const e of this.entries) {
        if (e.def.needs !== 'oi' || e.note) continue;
        const v = e.def.oiVenue;
        if (v === 'global') OI_EXCHANGES.forEach((x) => want.add(x));
        else if (v === 'self') want.add(exchange);
        else if (v) want.add(v as ExchangeId);
      }
    }
    const key = (x: ExchangeId) => `${x}|${symbol}|${tf}`;
    for (const [x, o] of this.oi) if (!want.has(x) || o.key !== key(x)) { o.off(); o.release(); this.oi.delete(x); }
    for (const x of want) {
      if (this.oi.has(x) || !symbol) continue;
      const stream = getOiStream({ exchange: x, symbol, tf });
      const release = stream.retain();
      // Data arrives via onData; status changes (e.g. 'unavailable': coin not listed there) via subscribe.
      const offData = stream.onData(() => this.refreshOi());
      const offStatus = stream.subscribe(() => this.refreshOi());
      const off = () => { offData(); offStatus(); };
      this.oi.set(x, { key: key(x), stream, release, off });
    }

    const densEntry = this.entries.find((e) => e.def.needs === 'densities' && !e.note);
    const dKey = densEntry && exchange && symbol ? `${exchange}|${this.ctx.market}|${symbol}|${densEntry.inst.params.join(',')}` : null;
    if (this.dens && this.dens.key !== dKey) { this.dens.off(); this.dens = null; }
    if (dKey && !this.dens && exchange && symbol && densEntry) {
      const [minK = 300] = densEntry.inst.params;
      const src = densitySource([{ venue: exchange, market: this.ctx.market }], 0, Math.max(100_000, minK * 1000), 12);
      const get = (): LiveLevel[] => {
        const card = src.getSnapshot().cards.find((c) => c.symbol === symbol);
        return card ? card.densities.map((d) => ({ price: d.price, side: d.side === 'bid' ? 'bid' : 'ask', notional: d.notional })) : [];
      };
      const off = src.subscribe(() => this.drawPriceLines());
      this.dens = { off, key: dKey, get };
    }
  }

  /* ── Values ── */

  private refreshOi(): void {
    // A venue that doesn't list this coin answers 'unavailable' / 'error' with no data: say so, drop the empty pane.
    let changed = false;
    for (const e of this.entries) {
      if (e.def.needs !== 'oi' || e.note || e.def.oiVenue === 'global') continue;
      const x = e.def.oiVenue === 'self' ? this.ctx.exchange : (e.def.oiVenue as ExchangeId);
      const o = x ? this.oi.get(x) : undefined;
      const st = o?.stream.getSnapshot().status;
      if (x && o && (st === 'unavailable' || st === 'error') && !o.stream.getPoints().length) {
        this.missing.set(e.def.id, `No ${ADAPTERS[x].name} open interest for ${this.ctx.symbol}`);
        changed = true;
      }
    }
    if (changed) { this.rebuild(); return; }
    for (const e of this.entries) if (e.def.needs === 'oi') this.push(e, true);
    this.emit('values');
  }

  private refresh(full: boolean): void {
    if (this.disposed) return;
    for (const e of this.entries) this.push(e, full);
    // Levels follow new candles; densities redraw when their feed updates.
    if (full || this.bars.length !== this.linesFor) { this.linesFor = this.bars.length; this.drawPriceLines(); }
    this.emit('values');
  }

  /** Output arrays for an entry over the current bars. */
  private compute(e: LayerEntry): Record<string, Series> | null {
    const { def } = e;
    if (e.note) return null;
    if (def.compute) return def.compute(this.bars, e.inst.params);
    if (def.needs === 'oi') {
      const span = TIMEFRAME_MS[this.ctx.tf];
      const venues = def.oiVenue === 'global' ? OI_EXCHANGES : def.oiVenue === 'self' ? (this.ctx.exchange ? [this.ctx.exchange] : []) : [def.oiVenue as ExchangeId];
      const held = venues.flatMap((x) => { const o = this.oi.get(x); const pts = o?.stream.getPoints() ?? []; return pts.length ? [holdOiOhlc(this.bars, pts, span)] : []; });
      const k = ohlcKeys('oi');
      if (!held.length) { const none = this.bars.map(() => null); return { oi: none, [k.o]: none, [k.h]: none, [k.l]: none }; }
      // Sum of base-unit OI across venues in USD — only where every venue with data covers the
      // bar (a venue whose history starts later would otherwise add a step). The open is valued
      // at the bar's open price and the rest at its close, so consecutive candles join up.
      // Summed highs / lows assume the venues peak together (a slight over-estimate of the range).
      const sum = (pick: (x: OiOhlc) => Series, i: number): number | null => {
        let s = 0;
        for (const x of held) { const v = pick(x)[i]; if (v === null) return null; s += v; }
        return s;
      };
      const oo: Series = [], hh: Series = [], ll: Series = [], cc: Series = [];
      this.bars.forEach((b, i) => {
        const [o, h, l, c] = [sum((x) => x.o, i), sum((x) => x.h, i), sum((x) => x.l, i), sum((x) => x.c, i)];
        if (o === null || h === null || l === null || c === null) { oo.push(null); hh.push(null); ll.push(null); cc.push(null); return; }
        const [ou, cu] = [o * b.o, c * b.c];
        oo.push(ou);
        cc.push(cu);
        hh.push(Math.max(ou, cu, h * b.c));
        ll.push(Math.min(ou, cu, l * b.c));
      });
      return { oi: cc, [k.o]: oo, [k.h]: hh, [k.l]: ll };
    }
    return null;
  }

  private push(e: LayerEntry, full: boolean): void {
    if (e.pane === null && e.def.placement !== 'priceLines') { e.last = {}; return; }
    const out = this.compute(e);
    if (!out) { e.last = {}; return; }
    const bars = this.bars;
    for (const o of e.outputs) {
      const vals = out[o.key] ?? [];
      let lastV: number | null = null;
      for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { lastV = vals[i]; break; }
      e.last[o.key] = lastV;
      const s = e.series.get(o.key);
      if (!s) continue;
      if (o.kind === 'candle') { this.pushCandles(e, o.key, s, out, full); continue; }
      const point = (i: number): WhitespaceData<Time> | { time: Time; value: number; color?: string } => {
        const v = vals[i];
        const time = T(bars[i].t);
        if (v === null || v === undefined) return { time };
        if (o.kind !== 'histogram') return { time, value: v };
        return { time, value: v, color: this.barColor(o, v, vals[i - 1] ?? null, bars[i], e.def.placement === 'background') };
      };
      if (full || !bars.length) {
        s.setData(bars.map((_, i) => point(i)));
      } else {
        try { s.update(point(bars.length - 1)); } catch { s.setData(bars.map((_, i) => point(i))); }
      }
    }
  }

  /** A candle output: OHLC from `key` (close) and `key.o/.h/.l`; the live bar keeps the extremes it has reached. */
  private pushCandles(e: LayerEntry, key: string, s: ISeriesApi<SeriesType>, out: Record<string, Series>, full: boolean): void {
    const bars = this.bars;
    const k = ohlcKeys(key);
    const [os, hs, ls, cs] = [out[k.o] ?? [], out[k.h] ?? [], out[k.l] ?? [], out[key] ?? []];
    const last = bars.length - 1;
    const live = (e.live ??= {});
    const point = (i: number): WhitespaceData<Time> | { time: Time; open: number; high: number; low: number; close: number } => {
      const time = T(bars[i].t);
      const [o, h, l, c] = [os[i], hs[i], ls[i], cs[i]];
      if (o == null || h == null || l == null || c == null) return { time };
      if (i !== last) return { time, open: o, high: h, low: l, close: c };
      const seen = live[key]?.t === bars[i].t ? live[key] : null;
      const hi = Math.max(h, seen?.h ?? h), lo = Math.min(l, seen?.l ?? l);
      live[key] = { t: bars[i].t, h: hi, l: lo };
      return { time, open: o, high: hi, low: lo, close: c };
    };
    if (full || !bars.length) s.setData(bars.map((_, i) => point(i)));
    else { try { s.update(point(last)); } catch { s.setData(bars.map((_, i) => point(i))); } }
  }

  private barColor(o: OutputDef, v: number, prevV: number | null, bar: RawCandle, faint: boolean): string {
    const up = o.colorBy === 'sign' ? v >= 0 : o.colorBy === 'rising' ? prevV === null || v >= prevV : o.colorBy === 'candle' ? bar.c >= bar.o : true;
    if (!o.colorBy) return o.color;
    return faint || o.colorBy === 'candle' ? (up ? UP_A : DOWN_A) : (up ? UP : DOWN);
  }

  /** Levels and Densities as price lines on the candle series. */
  private drawPriceLines(): void {
    if (this.disposed) return;
    this.priceLines.forEach((l) => { try { this.candles.removePriceLine(l); } catch { /* gone */ } });
    this.priceLines = [];
    for (const e of this.entries) {
      if (e.def.placement !== 'priceLines' || e.note || !e.inst.visible) continue;
      if (e.def.id === 'levels') {
        for (const l of findLevels(this.bars, e.inst.params)) {
          this.priceLines.push(this.candles.createPriceLine({
            price: l.price, color: l.side === 'resistance' ? 'rgba(229,72,77,0.55)' : 'rgba(48,164,108,0.55)',
            lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `${l.side === 'resistance' ? 'R' : 'S'}${l.touches}`,
          }));
        }
      } else if (e.def.id === 'densities') {
        const [minK = 300, perSide = 3] = e.inst.params;
        const all = (this.liveLevels ?? this.dens?.get() ?? []).filter((l) => l.notional >= minK * 1000);
        for (const side of ['bid', 'ask'] as const) {
          for (const l of all.filter((x) => x.side === side).sort((a, b) => b.notional - a.notional).slice(0, Math.round(perSide))) {
            this.priceLines.push(this.candles.createPriceLine({
              price: l.price, color: side === 'bid' ? UP : DOWN, lineStyle: LineStyle.Dotted, lineWidth: 2, axisLabelVisible: true, title: fmtUsd(l.notional),
            }));
          }
        }
      }
    }
  }
}

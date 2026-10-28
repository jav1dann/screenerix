'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CandlestickSeries, ColorType, createChart, CrosshairMode, LineStyle, TickMarkType,
} from 'lightweight-charts';
import type {
  AutoscaleInfo, CandlestickData, IChartApi, IPriceLine, ISeriesApi, MouseEventParams, Time, UTCTimestamp,
} from 'lightweight-charts';
import { fmtDateTime, fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import type { ChartStream } from '@/lib/market/chartStream';
import { TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { RawCandle } from '@/lib/market/exchanges';
import { useCtrlHeld } from '@/hooks/useCtrlHeld';
import { useIndicators, useSettings } from '@/hooks/useTerminal';
import { IndicatorLayer } from '@/lib/indicators/engine';
import type { LayerContext, LiveLevel } from '@/lib/indicators/engine';
import type { IndicatorScope } from '@/lib/indicators/store';
import type { IndicatorWindow } from '@/lib/indicators/ui';
import type { ChartStats } from '@/lib/market/chartStream';
import type { Settings } from '@/lib/settings/settings';
import { TradeLevelLayer, withLevels } from '@/lib/strategies/chartLines';
import type { TradeLevels } from '@/lib/strategies/chartLines';
import { COLORS } from '@/lib/theme';
import AlertLineOverlay from './AlertLineOverlay';
import ChartWatermark from './ChartWatermark';
import IndicatorLegend from './IndicatorLegend';
import MeasureOverlay from './MeasureOverlay';

export interface AlertLine {
  id: string;
  price: number;
  /** Unsaved line placed by a click. */
  draft: boolean;
  /** False once a one-time alert has fired. */
  active: boolean;
}

interface ChartCanvasProps {
  stream: ChartStream;
  symbol: string;
  /** Second watermark line when "Instrument type" is on, e.g. "BINANCE · FUTURES". */
  instrument?: string;
  /** Which indicator set this chart shows (Market Map cards by default). */
  scope?: IndicatorScope;
  /** The coin / venue behind the candles (null for a spread): OI, densities, market data. */
  win?: IndicatorWindow | null;
  /** Live stats for the Market Data indicator. */
  stats?: ChartStats | null;
  /** Live order-book walls for the Densities indicator (else the scanner's). */
  liveLevels?: readonly LiveLevel[] | null;
  /** Settings preview: indicators render, legend buttons are hidden. */
  readOnly?: boolean;
  /** A strategy formation's Entry / SL / TP1 / TP2 (kept on screen by the autoscale). */
  tradeLevels?: TradeLevels | null;
  /** Small overlay in the bottom-left corner (e.g. a formation's stage badge). */
  badge?: ReactNode;
  lines: readonly AlertLine[];
  /** User clicked the chart at `price`. */
  onPick: (price: number) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Save a just-placed line as a real alert (error message or null). */
  onSave?: (id: string) => Promise<string | null>;
  /** A line was dragged to `price` (error message or null). */
  onMove?: (id: string, price: number) => Promise<string | null>;
}

const NO_SAVE = async () => null;

/** Sub-panes that fit a card of this height. */
const paneBudget = (h: number) => (h < 260 ? 1 : h < 400 ? 2 : 4);
const pad2 = (n: number) => String(n).padStart(2, '0');
const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const toBar = (c: RawCandle): CandlestickData => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c });

/** Smallest price step that keeps the axis readable for this magnitude. */
function minMoveFor(price: number): number {
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.0001;
  if (price >= 0.01) return 0.00001;
  return 10 ** (Math.floor(Math.log10(price)) - 3);
}

/** Local-time tick labels (lightweight-charts treats timestamps as UTC). */
function tickLabel(time: Time, type: TickMarkType): string {
  const d = new Date((time as number) * 1000);
  switch (type) {
    case TickMarkType.Year: return String(d.getFullYear());
    case TickMarkType.Month: return d.toLocaleString('en-US', { month: 'short' });
    case TickMarkType.DayOfMonth: return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
    default: return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

/** Settings → Chart Settings as lightweight-charts options (the volume overlay keeps the bottom 20%). */
function layoutOptions(c: Settings['chart']) {
  const gridLine = { visible: c.grid };
  return {
    grid: { vertLines: gridLine, horzLines: gridLine },
    rightPriceScale: { scaleMargins: { top: c.gapTop / 100, bottom: c.gapBottom / 100 } },
  };
}

/** Zoom / right space: applied only when those settings change (re-applying resets the user's zoom). */
const zoomOptions = (c: Settings['chart']) => ({ timeScale: { barSpacing: c.candleWidth, rightOffset: c.rightSpace } });

export default function ChartCanvas({
  stream, symbol, instrument = '', lines, onPick, onEdit, onDelete, onSave = NO_SAVE, onMove = NO_SAVE, scope = 'card', win = null, stats = null, liveLevels = null, readOnly = false, tradeLevels = null, badge,
}: ChartCanvasProps) {
  const { chart: chartSettings } = useSettings();
  const indicators = useIndicators(scope);
  const ctrl = useCtrlHeld();
  const [layer, setLayer] = useState<IndicatorLayer | null>(null);
  const layerCtx: LayerContext = { exchange: win?.exchange ?? null, market: win?.market ?? 'futures', symbol: win?.symbol ?? null, tf: stream.key.tf };
  const ctxRef = useRef(layerCtx);
  const indicatorsRef = useRef(indicators);
  const settingsRef = useRef(chartSettings);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; candles: ISeriesApi<'Candlestick'> } | null>(null);
  const priceLines = useRef(new Map<string, IPriceLine>());
  const tradeLayer = useRef<TradeLevelLayer | null>(null);
  const linesRef = useRef(lines);
  const onPickRef = useRef(onPick);
  const [ys, setYs] = useState<Record<string, number | null>>({});
  /** Height of the price pane (alert lines live there). */
  const [paneH, setPaneH] = useState(0);

  useEffect(() => { linesRef.current = lines; onPickRef.current = onPick; settingsRef.current = chartSettings; ctxRef.current = layerCtx; indicatorsRef.current = indicators; });

  /* ── Chart lifecycle ── */
  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return undefined;
    const fontFamily = getComputedStyle(host).fontFamily || 'system-ui, sans-serif';

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.muted,
        fontFamily,
        fontSize: 11,
        attributionLogo: true, // required by the lightweight-charts licence
      },
      grid: { vertLines: { color: 'rgba(30,32,36,0.55)' }, horzLines: { color: 'rgba(30,32,36,0.55)' } },
      rightPriceScale: { borderColor: COLORS.line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: COLORS.line, timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: tickLabel },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.line2, labelBackgroundColor: COLORS.line2 },
        horzLine: { color: COLORS.line2, labelBackgroundColor: COLORS.line2 },
      },
      // No chart-wide priceFormatter: it would override each indicator pane's own format (OI in $, volume abbreviated).
      localization: { timeFormatter: (t: Time) => fmtDateTime((t as number) * 1000) },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false,
      priceFormat: { type: 'custom', formatter: fmtPrice, minMove: 0.01 },
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => withLevels(base(), tradeLayer.current?.prices ?? []),
    });
    chart.applyOptions({ ...layoutOptions(settingsRef.current), ...zoomOptions(settingsRef.current) });
    api.current = { chart, candles };
    const levels = new TradeLevelLayer(chart, candles);
    tradeLayer.current = levels;
    // Segments start on the origin candle once candles load (test hook: the start time).
    const anchorLevels = (data: readonly RawCandle[]) => { levels.update(data); wrap.dataset.tradeSegments = String(levels.startTime() ?? ''); };
    // Indicators (Settings → Indicator modal): overlays, background volume, sub-panes.
    const ind = new IndicatorLayer(chart, candles, ctxRef.current, { maxPanes: () => paneBudget(host.clientHeight), mainStretch: 2.5 });
    ind.sync(indicatorsRef.current);
    setLayer(ind);

    /* Alert popups follow their price lines through scroll, zoom, resize and new data. */
    let raf = 0;
    const syncOverlay = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next: Record<string, number | null> = {};
        for (const l of linesRef.current) next[l.id] = candles.priceToCoordinate(l.price);
        setPaneH(chart.panes()[0]?.getHeight() ?? 0);
        setYs((prev) => {
          const keys = Object.keys(next);
          if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])) return prev;
          return next;
        });
      });
    };

    const setAll = (data: RawCandle[]) => {
      candles.setData(data.map(toBar));
      ind.setBars(data, true);
      anchorLevels(data);
      const last = data[data.length - 1];
      if (last) candles.applyOptions({ priceFormat: { type: 'custom', formatter: fmtPrice, minMove: minMoveFor(last.c) } });
      syncOverlay();
    };
    setAll(stream.getCandles());
    // Live ticks: candles at once, indicators at most once per animation frame.
    let tickRaf = 0;
    const flushIndicators = () => { tickRaf = 0; ind.setBars(stream.getCandles(), false); };
    const offData = stream.onData((e) => {
      if (e.type === 'reset') { cancelAnimationFrame(tickRaf); tickRaf = 0; setAll(e.candles); return; }
      try {
        candles.update(toBar(e.candle));
      } catch {
        setAll(stream.getCandles()); // out-of-order bar — resync from the series
        return;
      }
      anchorLevels(stream.getCandles());
      if (!tickRaf) tickRaf = requestAnimationFrame(flushIndicators);
      syncOverlay();
    });

    /* Tooltip: imperative DOM updates keep hover at 60fps without React renders. */
    const onMove = (param: MouseEventParams<Time>) => {
      syncOverlay();
      const tip = tipRef.current;
      if (!tip) return;
      const bar = param.seriesData.get(candles) as CandlestickData | undefined;
      if (!param.point || param.time === undefined || !bar) { tip.style.opacity = '0'; return; }
      const ms = (param.time as number) * 1000;
      const vol = stream.getCandles().findLast((c) => c.t === ms)?.v;
      const change = bar.open ? bar.close / bar.open - 1 : 0;
      const set = (field: string, text: string, color?: string) => {
        const el = tip.querySelector<HTMLElement>(`[data-f="${field}"]`);
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
      };
      set('time', fmtDateTime((param.time as number) * 1000));
      set('change', fmtPct(change), change >= 0 ? COLORS.up : COLORS.down);
      set('volume', vol !== undefined ? fmtUsd(vol * bar.close) : '—');
      set('close', fmtPrice(bar.close));
      // `point` is relative to the hovered pane: offset it by that pane's top inside the wrapper.
      const paneEl = chart.panes()[param.paneIndex ?? 0]?.getHTMLElement();
      const paneTop = paneEl ? paneEl.getBoundingClientRect().top - wrap.getBoundingClientRect().top : 0;
      const x = param.point.x, y = param.point.y + paneTop;
      const w = wrap.clientWidth - chart.priceScale('right').width();
      const h = wrap.clientHeight - chart.timeScale().height();
      // Right of the cursor; flipped to its left near the price axis, so it never sits under the cursor.
      const left = x + 14 + tip.offsetWidth <= w ? x + 14 : x - 14 - tip.offsetWidth;
      const above = y - tip.offsetHeight - 12;
      const top = above >= 4 ? above : Math.min(y + 16, h - tip.offsetHeight - 4);
      tip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
      tip.style.opacity = '1';
    };
    chart.subscribeCrosshairMove(onMove);

    const onClick = (param: MouseEventParams<Time>) => {
      // Alerts are placed on the price pane only (sub-pane y maps to another scale).
      if (!param.point || (param.paneIndex ?? 0) !== 0) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price !== null && price > 0) onPickRef.current(price);
    };
    chart.subscribeClick(onClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncOverlay);

    const ro = new ResizeObserver(syncOverlay);
    ro.observe(host);

    const lineMap = priceLines.current;
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tickRaf);
      ro.disconnect();
      offData();
      ind.dispose();
      setLayer(null);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncOverlay);
      lineMap.clear();
      levels.clear();
      tradeLayer.current = null;
      api.current = null;
      chart.remove();
    };
  }, [stream, symbol]);

  /* ── Indicators: selection, coin / venue, live order-book walls ── */
  useEffect(() => { layer?.sync(indicators); }, [layer, indicators]);
  const { exchange: ctxExchange, market: ctxMarket, symbol: ctxSymbol, tf: ctxTf } = layerCtx;
  useEffect(() => {
    layer?.setContext({ exchange: ctxExchange, market: ctxMarket, symbol: ctxSymbol, tf: ctxTf });
  }, [layer, ctxExchange, ctxMarket, ctxSymbol, ctxTf]);
  useEffect(() => { layer?.setLiveLevels(liveLevels); }, [layer, liveLevels]);

  /* ── Chart Settings (gaps, grid; candle width and right space only when they change) ── */
  useEffect(() => {
    api.current?.chart.applyOptions(layoutOptions(chartSettings));
  }, [chartSettings, stream, symbol]);
  const { candleWidth, rightSpace } = chartSettings;
  const zoomKey = `${candleWidth}:${rightSpace}`;
  const zoomApplied = useRef(zoomKey);
  useEffect(() => {
    if (zoomApplied.current === zoomKey) return;
    zoomApplied.current = zoomKey;
    api.current?.chart.applyOptions(zoomOptions(settingsRef.current));
  }, [zoomKey]);

  /* ── Ctrl held: the crosshair snaps to the hovered candle's high / low / open / close ── */
  useEffect(() => {
    api.current?.chart.applyOptions({ crosshair: { mode: ctrl ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal } });
  }, [ctrl, stream, symbol]); // stream/symbol: the chart was recreated

  /* ── Strategy levels (Entry / SL / TP1 / TP2) ── */
  useEffect(() => {
    const levels = tradeLayer.current;
    if (!levels) return;
    const titles = levels.set(tradeLevels, stream.getCandles());
    // Which levels are drawn and where the segments start (the canvas has no DOM to inspect).
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.dataset.tradeLines = titles.join(',');
      wrap.dataset.tradeSegments = String(levels.startTime() ?? '');
    }
  }, [tradeLevels, stream, symbol]); // stream/symbol: the chart was recreated

  /* ── Keep price lines in sync with alerts ── */
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const map = priceLines.current;
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.id);
      const opts = {
        price: l.price,
        color: l.active ? COLORS.alert : 'rgba(245,197,66,0.4)',
        lineWidth: 1 as const,
        lineStyle: l.draft ? LineStyle.Dashed : l.active ? LineStyle.Solid : LineStyle.Dotted,
        axisLabelVisible: true,
        axisLabelColor: COLORS.alert,
        axisLabelTextColor: COLORS.bg,
        title: '',
      };
      const existing = map.get(l.id);
      if (existing) existing.applyOptions(opts);
      else map.set(l.id, a.candles.createPriceLine(opts));
    }
    for (const [id, line] of map) {
      if (!seen.has(id)) { a.candles.removePriceLine(line); map.delete(id); }
    }
    // Re-measure popup positions on the next frame.
    const raf = requestAnimationFrame(() => {
      const next: Record<string, number | null> = {};
      for (const l of lines) next[l.id] = a.candles.priceToCoordinate(l.price);
      setYs(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [lines, stream, symbol]); // stream/symbol: the chart (and its lines) was recreated

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full overflow-hidden [container-type:size]">
      {/* Large, faint coin name behind the (transparent) chart canvas. */}
      <ChartWatermark symbol={symbol} sub={instrument} settings={chartSettings} />
      <div ref={hostRef} className="absolute inset-0" />
      <IndicatorLegend layer={layer} wrapRef={wrapRef} scope={scope} win={win} stats={stats} readOnly={readOnly} />
      {badge && <div className="pointer-events-none absolute bottom-8 left-11 z-20">{badge}</div>}

      {/* Alert popups above their lines, and dragging the lines (`ys` re-renders this on scroll / zoom). */}
      {lines.length > 0 && (
        <AlertLineOverlay
          lines={lines}
          ys={ys}
          height={paneH}
          priceAt={(y) => api.current?.candles.coordinateToPrice(y) ?? null}
          onPreview={(id, price) => {
            const line = priceLines.current.get(id);
            const own = lines.find((l) => l.id === id)?.price;
            if (line && own !== undefined) line.applyOptions({ price: price ?? own });
          }}
          onSave={onSave}
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      {/* Shift+drag: temporary measurement box. */}
      <MeasureOverlay
        containerRef={wrapRef}
        getApi={() => (api.current ? { chart: api.current.chart, series: api.current.candles } : null)}
        getCandles={stream.getCandles}
        spanMs={TIMEFRAME_MS[stream.key.tf]}
      />

      {/* Hover tooltip (content filled imperatively). */}
      <div
        ref={tipRef}
        className="pointer-events-none absolute left-0 top-0 z-20 flex min-w-36 flex-col gap-0.5 rounded-lg border border-solid border-sx-line2 bg-[#0E0F12]/95 px-2.5 py-2 text-[11px] opacity-0 shadow-xl shadow-black/50 transition-opacity duration-75"
        aria-hidden="true"
      >
        <span data-f="time" className="font-semibold text-sx-text" />
        <span className="flex justify-between gap-3"><span className="text-sx-muted">Close</span><span data-f="close" className="tabular-nums" /></span>
        <span className="flex justify-between gap-3"><span className="text-sx-muted">Change</span><span data-f="change" className="tabular-nums" /></span>
        <span className="flex justify-between gap-3"><span className="text-sx-muted">Volume</span><span data-f="volume" className="tabular-nums" /></span>
      </div>
    </div>
  );
}

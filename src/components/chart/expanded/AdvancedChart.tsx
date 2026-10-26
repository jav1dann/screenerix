'use client';

/**
 * Multi-pane lightweight-charts view for the expanded terminal.
 *
 * Pane 0: candles, overlay indicators, alert price lines, watermark and the
 * drawing layer; sub-indicators get their own panes (`IndicatorLayer`, chosen in
 * the Indicator modal). Scrolling to the left edge pages in older history.
 * Candles update imperatively from `chartStream`; indicators are recomputed
 * at most once per animation frame and only the last point is pushed.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  CandlestickSeries, ColorType, createChart, createTextWatermark, CrosshairMode, LineStyle, PriceScaleMode, TickMarkType,
} from 'lightweight-charts';
import type {
  AutoscaleInfo, CandlestickData, IChartApi, IPriceLine, ISeriesApi, ITextWatermarkPluginApi, MouseEventParams, Time, UTCTimestamp,
} from 'lightweight-charts';
import { useCtrlHeld } from '@/hooks/useCtrlHeld';
import { useIndicators, useSettings } from '@/hooks/useTerminal';
import type { ChartPrefs } from '@/lib/drawings/chartPrefs';
import type { DrawPoint, Drawing, DrawingKind } from '@/lib/drawings/types';
import { fmtDateTime, fmtPrice } from '@/lib/format';
import { IndicatorLayer } from '@/lib/indicators/engine';
import type { IndicatorWindow } from '@/lib/indicators/ui';
import type { ChartStats, ChartStream } from '@/lib/market/chartStream';
import { TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { RawCandle } from '@/lib/market/exchanges';
import { TradeLevelLayer, withLevels } from '@/lib/strategies/chartLines';
import type { TradeLevels } from '@/lib/strategies/chartLines';
import { COLORS } from '@/lib/theme';
import type { AlertLine } from '../ChartCanvas';
import IndicatorLegend from '../IndicatorLegend';
import MeasureOverlay from '../MeasureOverlay';
import DrawingLayer from './DrawingLayer';
import type { DrawingLayerControls, DrawingPatch } from './DrawingLayer';
import type { Tool } from './tools';

export interface AdvancedChartControls {
  /** Download a PNG of all panes plus drawings. */
  snapshot(fileName: string): Promise<void>;
  /** Cancel an in-progress drawing; true if there was one. */
  cancelPending(): boolean;
  /**
   * Centre the view on `ms`, paging in older history as needed. `reached` is false
   * when the venue's history (or the page budget) ends after `ms`; `earliest` is
   * the oldest loaded bar.
   */
  goTo(ms: number): Promise<{ reached: boolean; earliest: number | null }>;
}

/** An order-book wall drawn as a price line. */
export interface ChartLevel { price: number; side: 'bid' | 'ask'; notional: number }

/** Older-history pages fetched for one go-to-date jump (300 bars each). */
const GOTO_MAX_PAGES = 20;
/** Load the previous page when fewer bars than this remain left of the view. */
const OLDER_EDGE_BARS = 20;

interface AdvancedChartProps {
  stream: ChartStream;
  /** The coin and venue (indicators: OI, densities, market data). */
  win: IndicatorWindow;
  /** Live 24h stats for the Market Data indicator. */
  stats?: ChartStats | null;
  symbol: string;
  prefs: ChartPrefs;
  tool: Tool;
  onToolDone: () => void;
  drawings: readonly Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (kind: DrawingKind, points: DrawPoint[], text?: string) => void;
  onUpdate: (id: string, points: DrawPoint[]) => void;
  onEditText: (id: string, text: string) => void;
  onPatch: (id: string, patch: DrawingPatch) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  alertLines: readonly AlertLine[];
  /** Live order-book walls, drawn by the Densities indicator instead of the scanner's. */
  levels?: readonly ChartLevel[];
  /** A strategy formation's Entry / SL / TP1 / TP2. */
  tradeLevels?: TradeLevels | null;
  onAlertPick: (price: number) => void;
  onAlertEdit: (id: string) => void;
  onAlertDelete: (id: string) => void;
  /** Hovered candle (null when the cursor leaves the chart). */
  onHover: (bar: RawCandle | null) => void;
  controls: RefObject<AdvancedChartControls | null>;
}

interface Core {
  /** False once the chart has been removed — effects must not touch it then. */
  alive: { current: boolean };
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  watermark: ITextWatermarkPluginApi<Time>;
  host: HTMLDivElement;
  fontFamily: string;
  layer: IndicatorLayer;
  levels: TradeLevelLayer;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** A 7px dot with its hotspot in the centre (TradingView's "Dot" cursor). */
const DOT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="3.5" fill="#EDEEF0" stroke="#0B0C0E" stroke-width="1.2"/></svg>')}") 6 6, crosshair`;
const HOST_CURSOR = { cross: 'crosshair', dot: DOT_CURSOR, pointer: 'default' } as const;
const T = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const toBar = (c: RawCandle): CandlestickData => ({ time: T(c.t), open: c.o, high: c.h, low: c.l, close: c.c });

function minMoveFor(price: number): number {
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.0001;
  if (price >= 0.01) return 0.00001;
  return 10 ** (Math.floor(Math.log10(price)) - 3);
}

function tickLabel(time: Time, type: TickMarkType): string {
  const d = new Date((time as number) * 1000);
  switch (type) {
    case TickMarkType.Year: return String(d.getFullYear());
    case TickMarkType.Month: return d.toLocaleString('en-US', { month: 'short' });
    case TickMarkType.DayOfMonth: return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
    case TickMarkType.TimeWithSeconds: return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    default: return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

export default function AdvancedChart(props: AdvancedChartProps) {
  const { stream, win, symbol, prefs, tool, alertLines } = props;
  const indicators = useIndicators('chart');
  const ctrl = useCtrlHeld();
  /** Magnet: the toolbar toggle, or Ctrl held. */
  const snap = prefs.magnet || ctrl;
  const { chart: chartSettings } = useSettings();
  const [core, setCore] = useState<Core | null>(null);
  const [view, setView] = useState(0);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const priceLines = useRef(new Map<string, IPriceLine>());
  const tradePrices = useRef<readonly number[]>([]);
  /** Go-to-date marker (bar open time), shown briefly after a jump. */
  const [marker, setMarker] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layerControls = useRef<DrawingLayerControls | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const span = TIMEFRAME_MS[stream.key.tf];
  const subMinute = stream.key.tf === '1s' || stream.key.tf === '30s';

  const layerCtx = useRef({ exchange: win.exchange, market: win.market, symbol: win.symbol, tf: stream.key.tf });
  useEffect(() => { layerCtx.current = { exchange: win.exchange, market: win.market, symbol: win.symbol, tf: stream.key.tf }; });

  // Latest callbacks for long-lived chart subscriptions.
  const cb = useRef({ onHover: props.onHover, onSelect: props.onSelect, tool });
  useEffect(() => { cb.current = { onHover: props.onHover, onSelect: props.onSelect, tool }; });

  /* ── Create the chart (callback ref: re-created when stream / symbol change) ── */
  const hostRef = useCallback((host: HTMLDivElement | null) => {
    if (!host) return undefined;
    const fontFamily = getComputedStyle(host).fontFamily || 'system-ui, sans-serif';
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.muted,
        fontFamily,
        fontSize: 11,
        attributionLogo: true, // required by the lightweight-charts licence
        panes: { separatorColor: COLORS.line, separatorHoverColor: COLORS.line2, enableResize: true },
      },
      grid: { vertLines: { color: 'rgba(30,32,36,0.55)' }, horzLines: { color: 'rgba(30,32,36,0.55)' } },
      rightPriceScale: { borderColor: COLORS.line, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: COLORS.line, timeVisible: true, rightOffset: 6, tickMarkFormatter: tickLabel },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.line2, labelBackgroundColor: COLORS.line2 },
        horzLine: { color: COLORS.line2, labelBackgroundColor: COLORS.line2 },
      },
      // No chart-wide priceFormatter: it would override each pane's own format (OI in $, volume abbreviated).
      localization: { timeFormatter: (t: Time) => fmtDateTime((t as number) * 1000) },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false,
      priceFormat: { type: 'custom', formatter: fmtPrice, minMove: 0.01 },
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => withLevels(base(), tradePrices.current),
    });
    const watermark = createTextWatermark(chart.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{ text: symbol, color: 'rgba(237,238,240,0.05)', fontSize: 120, fontFamily, fontStyle: '800' }],
    });
    const alive = { current: true };
    const layer = new IndicatorLayer(chart, candles, layerCtx.current, { maxPanes: () => (host.clientHeight < 360 ? 2 : 6), mainStretch: 3 });
    const levels = new TradeLevelLayer(chart, candles);
    setCore({ alive, chart, candles, watermark, host, fontFamily, layer, levels });
    return () => {
      alive.current = false;
      layer.dispose();
      priceLines.current.clear();
      levels.clear();
      tradePrices.current = [];
      chart.remove();
      setCore(null);
    };
  }, [symbol]);

  /* ── Seconds on the axis / crosshair for sub-minute timeframes ── */
  useEffect(() => {
    if (!core?.alive.current) return;
    core.chart.applyOptions({
      timeScale: { secondsVisible: subMinute },
      localization: {
        timeFormatter: (t: Time) => {
          const ms = (t as number) * 1000;
          return subMinute ? `${fmtDateTime(ms)}:${pad2(new Date(ms).getSeconds())}` : fmtDateTime(ms);
        },
      },
    });
  }, [core, subMinute]);

  /* ── Live data, hover, click, view tracking ── */
  useEffect(() => {
    if (!core?.alive.current) return undefined;
    const { chart, candles, host, layer, levels } = core;
    // Segments start on the origin candle once candles load (test hook: the start time).
    const anchorLevels = (data: readonly RawCandle[]) => {
      levels.update(data);
      if (wrapRef.current) wrapRef.current.dataset.tradeSegments = String(levels.startTime() ?? '');
    };
    let raf = 0;
    let dirty = false;
    const flush = () => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      layer.setBars(stream.getCandles(), false);
    };
    const setAll = (data: RawCandle[]) => {
      candles.setData(data.map(toBar));
      const last = data[data.length - 1];
      if (last) candles.applyOptions({ priceFormat: { type: 'custom', formatter: fmtPrice, minMove: minMoveFor(last.c) } });
      layer.setBars(data, true);
      anchorLevels(data);
    };
    setAll(stream.getCandles());
    chart.timeScale().scrollToRealTime(); // new timeframe / symbol: jump to the live edge
    let firstT = stream.getCandles()[0]?.t;
    const offData = stream.onData((e) => {
      if (e.type === 'reset') {
        // Older history was prepended: keep the same time window in view.
        const prepended = firstT !== undefined && e.candles[0] !== undefined && e.candles[0].t < firstT;
        const range = prepended ? chart.timeScale().getVisibleRange() : null;
        firstT = e.candles[0]?.t;
        setAll(e.candles);
        if (range) chart.timeScale().setVisibleRange(range);
        return;
      }
      try { candles.update(toBar(e.candle)); } catch { setAll(stream.getCandles()); return; }
      anchorLevels(stream.getCandles());
      dirty = true;
      if (!raf) raf = requestAnimationFrame(flush);
    });

    const onMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || !param.point) { cb.current.onHover(null); return; }
      const ms = (param.time as number) * 1000;
      const bars = stream.getCandles();
      let bar: RawCandle | null = null;
      for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].t === ms) { bar = bars[i]; break; } if (bars[i].t < ms) break; }
      cb.current.onHover(bar);
    };
    const onClick = () => { if (cb.current.tool === 'cross' || cb.current.tool === 'dot' || cb.current.tool === 'pointer') cb.current.onSelect(null); };
    // Scrolled to the left edge: page in older history.
    const onRange = (r: { from: number; to: number } | null) => {
      if (r && r.from < OLDER_EDGE_BARS) void stream.loadOlder();
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // Re-project drawings whenever the time range, price mapping or size changes.
    let loop = 0;
    let sig = '';
    const tick = () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      const last = stream.getCandles().at(-1)?.c ?? 1;
      const p0 = chart.panes()[0];
      const h = p0 ? p0.getHeight() : 0;
      const w = host.clientWidth;
      const next = `${r?.from},${r?.to},${candles.priceToCoordinate(last)},${candles.priceToCoordinate(last * 1.01)},${h},${w},${stream.getCandles().length}`;
      if (next !== sig) {
        sig = next;
        setView((v) => v + 1);
        setPane((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
      loop = requestAnimationFrame(tick);
    };
    loop = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(loop);
      offData();
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
    };
  }, [core, stream]);

  /* ── Indicators: selection, coin / venue, live order-book walls ── */
  useEffect(() => { core?.layer.sync(indicators); }, [core, indicators]);
  const { exchange, market } = win;
  const tf = stream.key.tf;
  useEffect(() => { core?.layer.setContext({ exchange, market, symbol, tf }); }, [core, exchange, market, symbol, tf]);
  const levelKey = props.levels?.map((l) => `${l.side}:${l.price}:${Math.round(l.notional)}`).join('|') ?? '';
  useEffect(() => {
    core?.layer.setLiveLevels(props.levels ?? null);
    // `levelKey` captures the content of `levels` (a fresh array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, levelKey]);

  /*
   * ── Zoom (candle width / right space) ──
   * Its own effect: lightweight-charts re-applies barSpacing / rightOffset on every
   * applyOptions call, so mixing them with tool / crosshair options reset the user's
   * zoom and scroll each time a drawing finished or a tool was picked.
   */
  const { candleWidth, rightSpace } = chartSettings;
  useEffect(() => {
    if (!core?.alive.current) return;
    core.chart.applyOptions({ timeScale: { barSpacing: candleWidth, rightOffset: rightSpace } });
  }, [core, candleWidth, rightSpace]);

  /*
   * ── Crosshair: magnet and cursor tool ──
   * Magnet on (or Ctrl held): the crosshair snaps to the hovered candle's nearest high / low /
   * open / close — wick tips and body edges. Off: it follows the cursor freely. The Arrow
   * cursor hides the crosshair lines (axis labels stay).
   */
  useEffect(() => {
    if (!core?.alive.current) return;
    const lines = tool !== 'pointer';
    core.chart.applyOptions({
      crosshair: {
        mode: snap ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal,
        vertLine: { visible: lines, labelVisible: true },
        horzLine: { visible: lines, labelVisible: true },
      },
    });
  }, [core, snap, tool]);

  /* ── Display options ── */
  useEffect(() => {
    if (!core?.alive.current) return;
    core.chart.applyOptions({ grid: { vertLines: { visible: chartSettings.grid }, horzLines: { visible: chartSettings.grid } } });
    core.chart.priceScale('right').applyOptions({ mode: prefs.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    const wm = chartSettings.watermark;
    core.watermark.applyOptions({ visible: wm.show, lines: [{ text: symbol, color: `rgba(237,238,240,${wm.opacity / 100})`, fontSize: 120, fontFamily: core.fontFamily, fontStyle: '800' }] });
  }, [core, chartSettings, symbol, prefs.logScale]);

  /* ── Alert price lines ── */
  useEffect(() => {
    if (!core?.alive.current) return;
    const map = priceLines.current;
    const seen = new Set<string>();
    for (const l of alertLines) {
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
      else map.set(l.id, core.candles.createPriceLine(opts));
    }
    for (const [id, line] of map) if (!seen.has(id)) { core.candles.removePriceLine(line); map.delete(id); }
  }, [core, alertLines]);

  /* ── Strategy levels ── */
  const { tradeLevels } = props;
  useEffect(() => {
    if (!core?.alive.current) return;
    const titles = core.levels.set(tradeLevels ?? null, stream.getCandles());
    tradePrices.current = core.levels.prices;
    // Which levels are drawn and where the segments start (the canvas has no DOM to inspect).
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.dataset.tradeLines = titles.join(',');
      wrap.dataset.tradeSegments = String(core.levels.startTime() ?? '');
    }
  }, [core, tradeLevels, stream]);

  /* ── Go-to-date marker fades after a moment ── */
  useEffect(() => {
    if (marker === null) return undefined;
    const t = setTimeout(() => setMarker(null), 2_500);
    return () => clearTimeout(t);
  }, [marker]);

  /* ── Imperative controls for the terminal ── */
  useImperativeHandle(props.controls, () => ({
      cancelPending: () => layerControls.current?.cancelPending() ?? false,
      async goTo(ms) {
        for (let page = 0; page < GOTO_MAX_PAGES && (stream.getCandles()[0]?.t ?? -Infinity) > ms; page++) {
          if (!(await stream.loadOlder())) break;
        }
        const bars = stream.getCandles();
        if (!core?.alive.current || !bars.length) return { reached: false, earliest: bars[0]?.t ?? null };
        const after = bars.findIndex((b) => b.t > ms);
        const i = after < 0 ? bars.length - 1 : Math.max(0, after - 1);
        const ts = core.chart.timeScale();
        const r = ts.getVisibleLogicalRange();
        const half = r ? Math.max(20, (r.to - r.from) / 2) : 60;
        ts.setVisibleLogicalRange({ from: i - half, to: i + half });
        setMarker(bars[i].t);
        return { reached: bars[0].t <= ms, earliest: bars[0].t };
      },
      async snapshot(fileName) {
        if (!core?.alive.current) return;
        // The chart canvas is transparent: paint the terminal background underneath.
        const shot = core.chart.takeScreenshot(true, false);
        const canvas = document.createElement('canvas');
        canvas.width = shot.width;
        canvas.height = shot.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#0D0E11';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(shot, 0, 0);
        const svg = svgRef.current;
        if (svg && !prefs.hidden) {
          const clone = svg.cloneNode(true) as SVGSVGElement;
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
          try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('svg')); img.src = url; });
            const ratio = canvas.width / Math.max(1, core.host.clientWidth);
            ctx.drawImage(img, 0, 0, svg.width.baseVal.value * ratio, svg.height.baseVal.value * ratio);
          } catch { /* drawings are optional in the snapshot */ } finally {
            URL.revokeObjectURL(url);
          }
        }
        await new Promise<void>((resolve) => canvas.toBlob((blob) => {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
          }
          resolve();
        }, 'image/png'));
      },
  }), [core, prefs.hidden, stream]);

  const markerX = marker !== null && core?.alive.current ? core.chart.timeScale().timeToCoordinate(T(marker)) : null;

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full overflow-hidden">
      {/* The cursor tool's mouse cursor; every pane inherits it (the chart only styles its axes). */}
      <div ref={hostRef} className="absolute inset-0" data-cursor={tool} style={{ cursor: HOST_CURSOR[tool as keyof typeof HOST_CURSOR] ?? 'crosshair' }} />
      {core && pane.h > 0 && (
        <DrawingLayer
          chart={core.chart}
          series={core.candles}
          stream={stream}
          view={view}
          width={pane.w}
          height={pane.h}
          fontFamily={core.fontFamily}
          tool={tool}
          magnet={snap}
          locked={prefs.locked}
          hidden={prefs.hidden}
          drawings={props.drawings}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          onCreate={props.onCreate}
          onUpdate={props.onUpdate}
          onEditText={props.onEditText}
          onPatch={props.onPatch}
          onDelete={props.onDelete}
          onClone={props.onClone}
          onToolDone={props.onToolDone}
          onHoverBar={(t) => props.onHover(t === null ? null : stream.getCandles().findLast((b) => b.t === t) ?? null)}
          alertLines={alertLines}
          onAlertPick={props.onAlertPick}
          onAlertEdit={props.onAlertEdit}
          onAlertDelete={props.onAlertDelete}
          svgRef={svgRef}
          controls={layerControls}
        />
      )}
      {core && <IndicatorLegend layer={core.layer} wrapRef={wrapRef} scope="chart" win={win} stats={props.stats ?? null} />}
      {markerX !== null && (
        <div aria-hidden="true" data-goto-marker className="pointer-events-none absolute top-0 z-20 w-0 border-0 border-l-2 border-dashed border-sx-alert" style={{ left: markerX, height: pane.h }} />
      )}
      <MeasureOverlay
        containerRef={wrapRef}
        getApi={() => (core?.alive.current ? { chart: core.chart, series: core.candles } : null)}
        getCandles={stream.getCandles}
        spanMs={span}
        active={tool === 'measure'}
        snap={prefs.magnet}
        onDone={tool === 'measure' ? props.onToolDone : undefined}
      />
    </div>
  );
}

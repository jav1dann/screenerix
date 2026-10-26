'use client';

/**
 * TradingView-style temporary Measure box: Δprice, %, bars, duration and volume
 * between two points. Start it by dragging with Shift held (anywhere) or with
 * the Measure tool active; a click without dragging switches to click–move–click.
 * The box stays pinned (in time/price, so it survives zoom and scroll) until the
 * next click or Esc, and is never saved.
 *
 * Pointer handling runs in the capture phase on `containerRef`, so the chart
 * underneath never sees a measuring gesture (no panning, no click-to-alert).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';
import { fmtDuration, logicalToTime, magnetSnap, measure, sumVolume, timeToLogical } from '@/lib/drawings/geometry';
import type { TimeAxis } from '@/lib/drawings/geometry';
import type { DrawPoint } from '@/lib/drawings/types';
import { fmtPct, fmtPrice, fmtQty } from '@/lib/format';
import type { RawCandle } from '@/lib/market/exchanges';
import { COLORS } from '@/lib/theme';

export interface MeasureApi { chart: IChartApi; series: ISeriesApi<'Candlestick'> }

interface MeasureOverlayProps {
  /** Element wrapping the chart host; receives the capture-phase listeners. */
  containerRef: RefObject<HTMLElement | null>;
  /** Current chart + price series (read only in handlers / animation frames). */
  getApi: () => MeasureApi | null;
  getCandles: () => readonly RawCandle[];
  /** Bar interval, used to extrapolate times past the last candle. */
  spanMs: number;
  /** The Measure tool is selected (Shift+drag works regardless). */
  active?: boolean;
  /** Snap both ends to the nearest O/H/L/C. */
  snap?: boolean;
  /** A measurement was completed. */
  onDone?: () => void;
}

type Phase = 'drag' | 'follow' | 'done';
interface Gesture { a: DrawPoint; b: DrawPoint; phase: Phase; downX: number; downY: number }

interface Geometry {
  x0: number; y0: number; x1: number; y1: number;
  plotW: number; paneH: number;
  up: boolean;
  lines: [string, string, string];
}

const BLUE = '#5B9DFF';
const CLICK_SLOP = 4; // px: below this, a press is a click (click–move–click mode)

export default function MeasureOverlay({ containerRef, getApi, getCandles, spanMs, active = false, snap = false, onDone }: MeasureOverlayProps) {
  const [geo, setGeo] = useState<Geometry | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const uid = useId().replace(/:/g, '');

  // Latest props for long-lived listeners.
  const cfg = useRef({ getApi, getCandles, spanMs, active, snap, onDone });
  useEffect(() => { cfg.current = { getApi, getCandles, spanMs, active, snap, onDone }; });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    let raf = 0;
    let sig = '';
    let swallowUntil = 0; // swallow the mouse/click events that follow a handled pointerdown

    const axisOf = (): TimeAxis => ({ times: cfg.current.getCandles().map((b) => b.t), spanMs: cfg.current.spanMs });
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const paneBox = (api: MeasureApi) => ({ w: api.chart.timeScale().width(), h: api.chart.panes()[0]?.getHeight() ?? 0 });

    const pointAt = (x: number, y: number): DrawPoint | null => {
      const api = cfg.current.getApi();
      if (!api) return null;
      const l = api.chart.timeScale().coordinateToLogical(x);
      const price = api.series.coordinateToPrice(y);
      if (l === null || price === null) return null;
      if (cfg.current.snap) {
        const s = magnetSnap(cfg.current.getCandles(), l, price);
        if (s) return s;
      }
      const time = logicalToTime(axisOf(), l);
      return time === null ? null : { time, price };
    };

    /** Project the gesture to pixels; runs every frame while a measurement exists. */
    const frame = () => {
      raf = 0;
      const g = gesture.current;
      const api = cfg.current.getApi();
      if (!g || !api) { sig = ''; setGeo(null); return; }
      const axis = axisOf();
      const ts = api.chart.timeScale();
      const xy = (p: DrawPoint) => {
        const l = timeToLogical(axis, p.time);
        return { x: l === null ? null : ts.logicalToCoordinate(l as Logical), y: api.series.priceToCoordinate(p.price) };
      };
      const A = xy(g.a);
      const B = xy(g.b);
      const { w, h } = paneBox(api);
      if (A.x !== null && A.y !== null && B.x !== null && B.y !== null) {
        const m = measure(g.a, g.b, axis);
        const vol = sumVolume(cfg.current.getCandles(), g.a.time, g.b.time);
        const sign = m.dPrice >= 0 ? '+' : '−';
        const next: Geometry = {
          x0: A.x, y0: A.y, x1: B.x, y1: B.y, plotW: w, paneH: h, up: m.dPrice >= 0,
          lines: [
            `${sign}${fmtPrice(Math.abs(m.dPrice))} (${fmtPct(m.pct).replace('-', '−')})`,
            `${m.bars} ${Math.abs(m.bars) === 1 ? 'bar' : 'bars'}, ${fmtDuration(m.ms)}`,
            `Vol ${fmtQty(vol)}`,
          ],
        };
        const s = JSON.stringify(next);
        if (s !== sig) { sig = s; setGeo(next); }
      }
      raf = requestAnimationFrame(frame);
    };
    const ensureLoop = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const clear = () => { gesture.current = null; ensureLoop(); };

    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    const isControl = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('button, a, input, select, textarea'));

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || isControl(e.target)) return;
      const g = gesture.current;
      const { x, y } = local(e);
      // Second click of click–move–click fixes the end point.
      if (g?.phase === 'follow') {
        g.b = pointAt(x, y) ?? g.b;
        g.phase = 'done';
        swallow(e);
        swallowUntil = Date.now() + 600;
        cfg.current.onDone?.();
        return;
      }
      const api = cfg.current.getApi();
      const box = api ? paneBox(api) : { w: 0, h: 0 };
      const inPane = x >= 0 && x <= box.w && y >= 0 && y <= box.h;
      if ((e.shiftKey || cfg.current.active) && inPane) {
        const p = pointAt(x, y);
        if (!p) return;
        gesture.current = { a: p, b: p, phase: 'drag', downX: x, downY: y };
        swallow(e);
        swallowUntil = Date.now() + 600;
        el.setPointerCapture?.(e.pointerId);
        ensureLoop();
        return;
      }
      // Any other click clears a finished measurement (and isn't passed on).
      if (g?.phase === 'done') {
        clear();
        swallow(e);
        swallowUntil = Date.now() + 600;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.phase === 'done') return;
      const { x, y } = local(e);
      g.b = pointAt(x, y) ?? g.b;
      ensureLoop();
    };

    const onPointerUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.phase !== 'drag') return;
      swallow(e);
      const { x, y } = local(e);
      el.releasePointerCapture?.(e.pointerId);
      if (Math.hypot(x - g.downX, y - g.downY) < CLICK_SLOP) {
        g.phase = 'follow'; // click without drag: the end follows the cursor until the next click
      } else {
        g.b = pointAt(x, y) ?? g.b;
        g.phase = 'done';
        cfg.current.onDone?.();
      }
      ensureLoop();
    };

    // Mouse / click events that belong to a handled gesture never reach the chart.
    const onMouse = (e: Event) => {
      if (Date.now() < swallowUntil || gesture.current?.phase === 'drag') swallow(e);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !gesture.current) return;
      e.stopPropagation(); // clear the measurement instead of closing the surrounding dialog
      e.preventDefault();
      clear();
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerUp, true);
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) el.addEventListener(t, onMouse, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerUp, true);
      for (const t of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) el.removeEventListener(t, onMouse, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [containerRef]);

  if (!geo) return null;
  const { x0, y0, x1, y1, plotW, paneH, up, lines } = geo;
  const color = up ? BLUE : COLORS.down;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.max(1, Math.abs(x1 - x0));
  const height = Math.max(1, Math.abs(y1 - y0));
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // Label: below the box when it fits, otherwise above; kept inside the plot.
  const labelW = Math.max(...lines.map((l) => l.length)) * 6.6 + 18;
  const labelH = 52;
  const below = top + height + 8 + labelH <= paneH;
  const ly = below ? top + height + 8 : Math.max(2, top - labelH - 8);
  const lx = Math.min(Math.max(2, mx - labelW / 2), Math.max(2, plotW - labelW - 2));

  return (
    <svg className="pointer-events-none absolute left-0 top-0 z-[25] select-none" width={plotW} height={paneH} aria-hidden="true" data-measure="true">
      <defs>
        <marker id={`${uid}-tip`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill={color} />
        </marker>
        <clipPath id={`${uid}-clip`}><rect x={0} y={0} width={plotW} height={paneH} /></clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <rect x={left} y={top} width={width} height={height} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.5} />
        {height > 6 && <line x1={mx} y1={y0} x2={mx} y2={y1} stroke={color} strokeWidth={1.5} markerEnd={`url(#${uid}-tip)`} />}
        {width > 6 && <line x1={x0} y1={my} x2={x1} y2={my} stroke={color} strokeWidth={1.5} markerEnd={`url(#${uid}-tip)`} />}
        <g transform={`translate(${lx} ${ly})`}>
          <rect width={labelW} height={labelH} rx={6} fill={color} fillOpacity={0.92} />
          {lines.map((l, i) => (
            <text key={i} x={labelW / 2} y={15 + i * 15} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={i === 0 ? 700 : 500} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {l}
            </text>
          ))}
        </g>
      </g>
    </svg>
  );
}

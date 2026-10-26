'use client';

/**
 * SVG overlay for drawings on the main price pane.
 *
 * Drawings are stored in market coordinates (time, price) and projected every
 * render through lightweight-charts' logical/price mapping, so they stay pinned
 * through scroll, zoom and timeframe changes. With a cursor tool the overlay
 * lets pointer events through to the chart (pan / zoom), except on drawings
 * themselves (their stroke; an area drawing's inside only once selected), which
 * can be selected and dragged. With a drawing tool it captures input to place
 * points, and a press on an existing drawing selects it instead. While the
 * overlay has the pointer it drives the chart's crosshair, so the crosshair
 * keeps following the cursor. The selected drawing gets a floating context bar
 * (colour, width, style, lock, clone, delete). Text notes are placed and edited
 * through a small inline input (double-click a note to edit it).
 */
import { useImperativeHandle, useRef, useState } from 'react';
import { Copy, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from 'lightweight-charts';
import { IconAlarm, IconPencil, IconTrash } from '@/components/shared/icons';
import { extendToBox, fibPrice, FIB_LEVELS, fmtDuration, logicalToTime, magnetSnap, measure, timeToLogical, translate } from '@/lib/drawings/geometry';
import type { TimeAxis } from '@/lib/drawings/geometry';
import { dashArray, DEFAULT_COLOR, DEFAULT_WIDTH, DRAWING_LABEL, DRAWING_PALETTE, LINE_STYLES, LINE_WIDTHS, PLACEMENT } from '@/lib/drawings/types';
import type { DrawPoint, Drawing, DrawingKind, LineStyleId } from '@/lib/drawings/types';
import { fmtDateTime, fmtPct, fmtPrice } from '@/lib/format';
import type { ChartStream } from '@/lib/market/chartStream';
import { TIMEFRAME_MS } from '@/lib/market/exchanges';
import { COLORS } from '@/lib/theme';
import type { AlertLine } from '../ChartCanvas';
import { BTN_RESET } from '../styles';
import { isDrawingTool } from './tools';
import type { Tool } from './tools';

export interface DrawingLayerControls {
  /** Cancel an in-progress drawing; returns true if there was one. */
  cancelPending(): boolean;
}

interface DrawingLayerProps {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  stream: ChartStream;
  /** Re-render signal from the chart (scroll / zoom / resize / data). */
  view: number;
  width: number;
  height: number;
  /** Resolved font stack (also embedded in snapshots). */
  fontFamily: string;
  tool: Tool;
  magnet: boolean;
  locked: boolean;
  hidden: boolean;
  drawings: readonly Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (kind: DrawingKind, points: DrawPoint[], text?: string) => void;
  onUpdate: (id: string, points: DrawPoint[]) => void;
  /** Change a text note; an empty text removes it. */
  onEditText: (id: string, text: string) => void;
  /** Restyle / lock a drawing (context bar). */
  onPatch: (id: string, patch: DrawingPatch) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onToolDone: () => void;
  /**
   * Bar under the cursor while the overlay has the pointer (null on leave). The synced
   * crosshair fires no crosshair-move event, so the hover readout is fed from here.
   */
  onHoverBar: (barTime: number | null) => void;
  alertLines: readonly AlertLine[];
  onAlertPick: (price: number) => void;
  onAlertEdit: (id: string) => void;
  onAlertDelete: (id: string) => void;
  svgRef: RefObject<SVGSVGElement | null>;
  controls: RefObject<DrawingLayerControls | null>;
}

export type DrawingPatch = Partial<Pick<Drawing, 'color' | 'width' | 'style' | 'locked'>>;

const FIB_FILLS = ['#E5484D', '#F5A524', '#30A46C', '#5B9DFF', '#30A46C', '#B48CFF'];
const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
const TEXT_SIZE = 13;
/** Rough rendered width of a note (hit box / selection outline). */
const textWidth = (text: string) => Math.max(12, text.length * TEXT_SIZE * 0.6);

interface Projector {
  x(time: number): number | null;
  y(price: number): number | null;
  plotW: number;
  h: number;
  axis: TimeAxis;
}

/** Visible shape(s) for a drawing in pixel space. */
function Shape({ kind, points, color, p, selected, text = '', width = DEFAULT_WIDTH, lineStyle }: {
  kind: DrawingKind; points: DrawPoint[]; color: string; p: Projector; selected: boolean; text?: string; width?: number; lineStyle?: LineStyleId;
}): ReactNode {
  const xy = points.map((pt) => [p.x(pt.time), p.y(pt.price)] as const);
  if (xy.some(([x, y]) => x === null || y === null)) return null;
  const pts = xy as ReadonlyArray<readonly [number, number]>;
  const sw = width + (selected ? 0.5 : 0);
  const dash = dashArray(lineStyle, sw);
  const [a, b] = [pts[0], pts[1] ?? pts[0]];
  const label = (x: number, y: number, text: string, fill = color, anchor: 'start' | 'end' | 'middle' = 'start') => (
    <text x={x} y={y} fill={fill} fontSize={11} fontWeight={600} textAnchor={anchor} style={{ paintOrder: 'stroke', stroke: COLORS.bg, strokeWidth: 3 }}>{text}</text>
  );

  switch (kind) {
    case 'trend':
      return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={sw} strokeDasharray={dash} />;
    case 'arrow':
      return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={sw + 0.5} strokeDasharray={dash} markerEnd="url(#sx-arrowhead)" />;
    case 'ray':
    case 'extended': {
      const [x1, y1, x2, y2] = extendToBox(a[0], a[1], b[0], b[1], p.plotW, p.h, kind === 'extended');
      return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sw} strokeDasharray={dash} />;
    }
    case 'hline':
      return <>
        <line x1={0} y1={a[1]} x2={p.plotW} y2={a[1]} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
        {label(p.plotW - 6, a[1] - 5, fmtPrice(points[0].price), color, 'end')}
      </>;
    case 'hray':
      return <>
        <line x1={a[0]} y1={a[1]} x2={p.plotW} y2={a[1]} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
        {label(a[0] + 6, a[1] - 5, fmtPrice(points[0].price))}
      </>;
    case 'vline':
      return <>
        <line x1={a[0]} y1={0} x2={a[0]} y2={p.h} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
        {label(a[0] + 6, p.h - 8, fmtDateTime(points[0].time))}
      </>;
    case 'rect':
    case 'ellipse': {
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return kind === 'rect'
        ? <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={alpha(color, 0.12)} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
        : <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} fill={alpha(color, 0.12)} stroke={color} strokeWidth={sw} strokeDasharray={dash} />;
    }
    case 'brush':
      return <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={color} strokeWidth={sw + 0.5} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />;
    case 'fib': {
      const x0 = Math.min(a[0], b[0]);
      const x1 = Math.max(a[0], b[0]);
      const levels = FIB_LEVELS.map((lv) => ({ lv, price: fibPrice(points[0], points[1] ?? points[0], lv) })).map((l) => ({ ...l, y: p.y(l.price) }));
      return <>
        {levels.slice(0, -1).map((l, i) => {
          const nx = levels[i + 1];
          if (l.y === null || nx.y === null) return null;
          return <rect key={`f${l.lv}`} x={x0} y={Math.min(l.y, nx.y)} width={x1 - x0} height={Math.abs(nx.y - l.y)} fill={alpha(FIB_FILLS[i], 0.08)} />;
        })}
        {levels.map((l, i) => l.y === null ? null : (
          <g key={l.lv}>
            <line x1={x0} y1={l.y} x2={x1} y2={l.y} stroke={i === 0 || i === levels.length - 1 ? color : FIB_FILLS[Math.min(i, FIB_FILLS.length - 1)]} strokeWidth={1} />
            {label(x0 + 4, l.y - 4, `${l.lv} (${fmtPrice(l.price)})`, '#B8BAC4')}
          </g>
        ))}
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={1} strokeDasharray="4 4" />
      </>;
    }
    case 'priceRange':
    case 'ruler': {
      const m = measure(points[0], points[1] ?? points[0], p.axis);
      const tone = m.dPrice >= 0 ? COLORS.up : COLORS.down;
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      const mx = (x0 + x1) / 2;
      const text = `${m.dPrice >= 0 ? '+' : ''}${fmtPrice(m.dPrice)} (${fmtPct(m.pct)})${kind === 'ruler' ? ` · ${m.bars} bars · ${fmtDuration(m.ms)}` : ''}`;
      const ly = m.dPrice >= 0 ? y0 - 8 : y1 + 16;
      return <>
        <rect x={x0} y={y0} width={Math.max(1, x1 - x0)} height={y1 - y0} fill={alpha(tone, 0.14)} stroke={alpha(tone, 0.6)} strokeWidth={1} />
        <line x1={mx} y1={a[1]} x2={mx} y2={b[1]} stroke={tone} strokeWidth={1.5} markerEnd={m.dPrice >= 0 ? 'url(#sx-tip-up)' : 'url(#sx-tip-down)'} />
        {kind === 'ruler' && <line x1={a[0]} y1={(y0 + y1) / 2} x2={b[0]} y2={(y0 + y1) / 2} stroke={tone} strokeWidth={1} strokeDasharray="3 3" />}
        {label(mx, ly, text, tone, 'middle')}
      </>;
    }
    case 'text':
      return <>
        {selected && <rect x={a[0] - 4} y={a[1] - TEXT_SIZE - 3} width={textWidth(text) + 8} height={TEXT_SIZE + 9} rx={4} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 2" />}
        <text x={a[0]} y={a[1]} fill={color} fontSize={TEXT_SIZE} fontWeight={600} style={{ paintOrder: 'stroke', stroke: COLORS.bg, strokeWidth: 3 }}>{text}</text>
      </>;
    default:
      return null;
  }
}

/**
 * Invisible fat stroke used for hit-testing. Area drawings are grabbed by their
 * outline, and anywhere inside only once selected — so a box doesn't swallow the
 * chart's pan / zoom / crosshair over everything it covers.
 */
function HitArea({ kind, points, p, text = '', selected }: { kind: DrawingKind; points: DrawPoint[]; p: Projector; text?: string; selected: boolean }) {
  const xy = points.map((pt) => [p.x(pt.time), p.y(pt.price)] as const);
  if (xy.some(([x, y]) => x === null || y === null)) return null;
  const pts = xy as ReadonlyArray<readonly [number, number]>;
  const [a, b] = [pts[0], pts[1] ?? pts[0]];
  const hit = { stroke: 'transparent', strokeWidth: 12, fill: 'none', style: { pointerEvents: 'stroke' as const } };
  switch (kind) {
    case 'hline': return <line x1={0} y1={a[1]} x2={p.plotW} y2={a[1]} {...hit} />;
    case 'hray': return <line x1={a[0]} y1={a[1]} x2={p.plotW} y2={a[1]} {...hit} />;
    case 'vline': return <line x1={a[0]} y1={0} x2={a[0]} y2={p.h} {...hit} />;
    case 'ray':
    case 'extended': {
      const [x1, y1, x2, y2] = extendToBox(a[0], a[1], b[0], b[1], p.plotW, p.h, kind === 'extended');
      return <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />;
    }
    case 'brush': return <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} {...hit} />;
    case 'trend':
    case 'arrow': return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...hit} />;
    case 'text': return <rect x={a[0] - 4} y={a[1] - TEXT_SIZE - 3} width={textWidth(text) + 8} height={TEXT_SIZE + 9} fill="transparent" style={{ pointerEvents: 'all' }} />;
    case 'ellipse': {
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} {...hit} fill="transparent" style={{ pointerEvents: selected ? 'all' : 'stroke' }} />;
    }
    default: {
      // Area tools (rect, fib, ranges): the outline, or the whole box once selected.
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return <rect x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} {...hit} fill="transparent" style={{ pointerEvents: selected ? 'all' : 'stroke' }} />;
    }
  }
}

/** Pixel bounding box of a drawing (null when off the time axis). */
function bbox(d: Drawing, p: Projector): { x0: number; x1: number; y0: number; y1: number } | null {
  const xs: number[] = [], ys: number[] = [];
  for (const pt of d.points) {
    const x = d.kind === 'hline' ? p.plotW / 2 : p.x(pt.time);
    const y = d.kind === 'vline' ? p.h / 2 : p.y(pt.price);
    if (x === null || y === null) return null;
    xs.push(x);
    ys.push(y);
  }
  if (d.kind === 'text') ys.push(ys[0] - TEXT_SIZE);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const BAR_BTN = `${BTN_RESET} grid h-7 min-w-7 place-items-center rounded-md px-1 text-sx-muted hover:bg-white/[0.08] hover:text-sx-text`;
const BAR_W = 248;
const PANEL = 'rounded-lg border border-solid border-sx-line2 bg-[#14151A]/95 shadow-xl shadow-black/50';

/** Floating toolbar over the selected drawing: colour, width, style, lock, clone, delete. */
function DrawingContextBar({ drawing: d, anchor, plotW, height, onPatch, onClone, onDelete }: {
  drawing: Drawing; anchor: { x0: number; x1: number; y0: number; y1: number }; plotW: number; height: number;
  onPatch: (patch: DrawingPatch) => void; onClone: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState<'color' | 'width' | 'style' | null>(null);
  const width = d.width ?? DEFAULT_WIDTH;
  const style = d.style ?? 'solid';
  const lined = d.kind !== 'text' && d.kind !== 'fib' && d.kind !== 'priceRange' && d.kind !== 'ruler';
  const left = Math.max(4, Math.min((anchor.x0 + anchor.x1) / 2 - BAR_W / 2, plotW - BAR_W - 4));
  // Above the drawing; below it when there's no room; inside the pane either way.
  const above = anchor.y0 - 46;
  const top = Math.max(4, above >= 4 ? above : Math.min(anchor.y1 + 14, height - 40));
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const same = (c: string) => c.toLowerCase() === d.color.toLowerCase();
  return (
    <div
      role="toolbar"
      aria-label={`${DRAWING_LABEL[d.kind]} options`}
      data-drawing-bar={d.id}
      className="absolute z-30 flex flex-col gap-1"
      style={{ left, top }}
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <div className={`${PANEL} flex items-center gap-0.5 self-start p-0.5`}>
        <button type="button" className={BAR_BTN} onClick={() => setMenu(menu === 'color' ? null : 'color')} aria-label="Colour" title="Colour" aria-expanded={menu === 'color'}>
          <span className="h-4 w-4 rounded-full border border-solid border-white/20" style={{ background: d.color }} />
        </button>
        {lined && (
          <>
            <button type="button" className={BAR_BTN} onClick={() => setMenu(menu === 'width' ? null : 'width')} aria-label="Line width" title="Line width" aria-expanded={menu === 'width'}>
              <span className="text-[11px] font-bold tabular-nums text-sx-text">{width}px</span>
            </button>
            <button type="button" className={BAR_BTN} onClick={() => setMenu(menu === 'style' ? null : 'style')} aria-label="Line style" title="Line style" aria-expanded={menu === 'style'}>
              <StyleGlyph style={style} />
            </button>
          </>
        )}
        <span className="mx-0.5 h-5 w-px bg-sx-line2" aria-hidden="true" />
        <button type="button" className={BAR_BTN} onClick={() => onPatch({ locked: !d.locked })} aria-label={d.locked ? 'Unlock drawing' : 'Lock drawing'} title={d.locked ? 'Unlock' : 'Lock in place'} aria-pressed={Boolean(d.locked)}>
          {d.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        </button>
        <button type="button" className={BAR_BTN} onClick={onClone} aria-label="Clone drawing" title="Clone (Ctrl+D)">
          <Copy size={14} aria-hidden="true" />
        </button>
        <button type="button" className={`${BAR_BTN} hover:!bg-sx-down/20 hover:!text-sx-down`} onClick={onDelete} aria-label="Delete drawing" title="Delete (Del)">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      {menu === 'color' && (
        <div className={`${PANEL} flex flex-wrap items-center gap-1 p-1.5`} style={{ width: BAR_W }} role="group" aria-label="Colours">
          {DRAWING_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`${BTN_RESET} h-5 w-5 rounded-full border-2 border-solid ${same(c) ? 'border-white' : 'border-transparent'}`}
              style={{ background: c }}
              onClick={() => onPatch({ color: c })}
              aria-label={`Colour ${c}`}
              aria-pressed={same(c)}
            />
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-sx-muted" title="Custom colour">
            Custom
            <input type="color" value={d.color} onChange={(e) => onPatch({ color: e.target.value })} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Custom colour" />
          </label>
        </div>
      )}
      {menu === 'width' && (
        <div className={`${PANEL} flex gap-1 self-start p-1`} role="group" aria-label="Line widths">
          {LINE_WIDTHS.map((w) => (
            <button key={w} type="button" className={`${BAR_BTN} w-12 ${w === width ? '!bg-white/[0.1] !text-sx-text' : ''}`} onClick={() => { onPatch({ width: w }); setMenu(null); }} aria-label={`${w}px`} aria-pressed={w === width}>
              <span className="block w-7 rounded-full" style={{ height: w, background: d.color }} />
            </button>
          ))}
        </div>
      )}
      {menu === 'style' && (
        <div className={`${PANEL} flex gap-1 self-start p-1`} role="group" aria-label="Line styles">
          {LINE_STYLES.map((st) => (
            <button key={st} type="button" className={`${BAR_BTN} w-12 ${st === style ? '!bg-white/[0.1] !text-sx-text' : ''}`} onClick={() => { onPatch({ style: st }); setMenu(null); }} aria-label={st} aria-pressed={st === style}>
              <StyleGlyph style={st} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StyleGlyph({ style }: { style: LineStyleId }) {
  return (
    <svg width={22} height={8} aria-hidden="true">
      <line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={2} strokeDasharray={dashArray(style, 2)} strokeLinecap={style === 'dotted' ? 'round' : undefined} />
    </svg>
  );
}

type Drag =
  | { mode: 'move'; id: string; startL: number; startP: number; original: DrawPoint[] }
  | { mode: 'handle'; id: string; index: number; original: DrawPoint[] };

export default function DrawingLayer(props: DrawingLayerProps) {
  const {
    chart, series, stream, view, width, height, fontFamily, tool, magnet, locked, hidden, drawings, selectedId,
    onSelect, onCreate, onUpdate, onEditText, onPatch, onDelete, onClone, onToolDone, onHoverBar, alertLines, onAlertPick, onAlertEdit, onAlertDelete, svgRef, controls,
  } = props;
  const [pending, setPending] = useState<{ kind: DrawingKind; points: DrawPoint[] } | null>(null);
  const [hover, setHover] = useState<DrawPoint | null>(null);
  const [preview, setPreview] = useState<{ id: string; points: DrawPoint[] } | null>(null);
  /** Inline text editor: a new note at `point`, or an existing one (`id`). */
  const [editor, setEditor] = useState<{ id: string | null; point: DrawPoint; value: string } | null>(null);
  /** Set once the open editor has been committed / cancelled (Enter and the following blur both land here). */
  const editorDone = useRef(false);
  const openEditor = (next: { id: string | null; point: DrawPoint; value: string }) => { editorDone.current = false; setEditor(next); };
  const drag = useRef<Drag | null>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  // Let the terminal cancel an in-progress drawing (Escape).
  useImperativeHandle(controls, () => ({
    cancelPending() {
      if (editor) { editorDone.current = true; setEditor(null); return true; }
      if (!pending) return false;
      setPending(null);
      setHover(null);
      return true;
    },
  }), [pending, editor]);

  const commitText = () => {
    if (!editor || editorDone.current) return;
    editorDone.current = true;
    const text = editor.value.trim();
    if (editor.id) onEditText(editor.id, text);
    else if (text) { onCreate('text', [editor.point], text); onToolDone(); }
    setEditor(null);
  };

  // ── Projection ────────────────────────────────────────────────────────
  const bars = stream.getCandles();
  const axis: TimeAxis = { times: bars.map((b) => b.t), spanMs: TIMEFRAME_MS[stream.key.tf] };
  const ts = chart.timeScale();
  const plotW = Math.max(0, ts.width());
  const proj: Projector = {
    x: (time) => {
      const l = timeToLogical(axis, time);
      return l === null ? null : ts.logicalToCoordinate(l as Logical);
    },
    y: (price) => series.priceToCoordinate(price),
    plotW,
    h: height,
    axis,
  };

  const local = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as Element).closest('svg')?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  /** Pixel → market point, magnet-snapped when enabled. */
  const pointAt = (x: number, y: number, snap = magnet): DrawPoint | null => {
    const l = ts.coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (l === null || price === null) return null;
    if (snap) {
      const s = magnetSnap(bars, l, price);
      if (s) return s;
    }
    const time = logicalToTime(axis, l);
    return time === null ? null : { time, price };
  };

  /** The overlay has the pointer, so the chart doesn't see it: drive its crosshair from here. */
  const syncCrosshair = (x: number, y: number, pt?: DrawPoint | null) => {
    if (!bars.length) return;
    const l = ts.coordinateToLogical(x);
    const price = pt?.price ?? series.coordinateToPrice(y);
    if (l === null || price === null) return;
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(l)));
    chart.setCrosshairPosition(price, Math.floor(bars[i].t / 1000) as UTCTimestamp, series);
    onHoverBar(bars[i].t);
  };

  // ── Placing new drawings (drawing tools capture input) ────────────────
  const capturing = isDrawingTool(tool) || tool === 'alert';

  const finish = (kind: DrawingKind, points: DrawPoint[]) => {
    onCreate(kind, points);
    setPending(null);
    setHover(null);
    onToolDone();
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    const pt = pointAt(x, y, magnet || e.ctrlKey);
    if (!pt) return;
    if (tool === 'alert') { onAlertPick(pt.price); onToolDone(); return; }
    if (!isDrawingTool(tool)) return;
    if (tool === 'text') { e.preventDefault(); openEditor({ id: null, point: pt, value: '' }); return; }
    const placement = PLACEMENT[tool];
    if (placement === 'single') { finish(tool, [pt]); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    downAt.current = { x, y };
    if (placement === 'drag') { setPending({ kind: tool, points: [pt] }); return; }
    if (!pending) setPending({ kind: tool, points: [pt] });
    else finish(pending.kind, [pending.points[0], pt]);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(e);
    const pt = pointAt(x, y, magnet || e.ctrlKey);
    syncCrosshair(x, y, magnet || e.ctrlKey ? pt : null);
    if (!pt) return;
    if (pending?.kind === 'brush' && downAt.current) {
      const last = pending.points[pending.points.length - 1];
      const lx = proj.x(last.time);
      const ly = proj.y(last.price);
      if (lx === null || ly === null || Math.hypot(x - lx, y - ly) >= 3) setPending({ ...pending, points: [...pending.points, pointAt(x, y, false) ?? pt] });
      return;
    }
    setHover(pt);
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const start = downAt.current;
    downAt.current = null;
    if (!pending) return;
    if (pending.kind === 'brush') {
      if (pending.points.length > 1) finish('brush', pending.points); else setPending(null);
      return;
    }
    // Press-drag-release also places a two-point drawing.
    const { x, y } = local(e);
    if (start && Math.hypot(x - start.x, y - start.y) > 6) {
      const pt = pointAt(x, y, magnet || e.ctrlKey);
      if (pt) finish(pending.kind, [pending.points[0], pt]);
    }
  };

  // ── Selecting / moving existing drawings (cursor tools) ───────────────
  const beginDrag = (e: ReactPointerEvent<SVGElement>, d: Drawing, index: number | null) => {
    if (locked || e.button !== 0) return;
    // Mid-placement (second point, alert, text): the press belongs to the new drawing.
    if (capturing && (pending || editor || tool === 'alert')) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(d.id);
    // A press on a drawing with a drawing tool picks it (back to the cursor) instead of placing a new one.
    if (capturing) onToolDone();
    if (d.locked) return;
    const { x, y } = local(e);
    const l = ts.coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (l === null || price === null) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = index === null
      ? { mode: 'move', id: d.id, startL: l, startP: price, original: d.points }
      : { mode: 'handle', id: d.id, index, original: d.points };
  };

  const onDragMove = (e: ReactPointerEvent<SVGElement>) => {
    const g = drag.current;
    const { x, y } = local(e);
    if (!capturing) syncCrosshair(x, y);
    if (!g) return;
    if (g.mode === 'handle') {
      const pt = pointAt(x, y, magnet || e.ctrlKey);
      if (pt) setPreview({ id: g.id, points: g.original.map((p, i) => (i === g.index ? pt : p)) });
      return;
    }
    const l = ts.coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (l === null || price === null) return;
    setPreview({ id: g.id, points: translate(g.original, axis, l - g.startL, price - g.startP) });
  };

  const endDrag = () => {
    if (drag.current && preview && preview.id === drag.current.id) onUpdate(preview.id, preview.points);
    drag.current = null;
    setPreview(null);
  };

  // ── Render ────────────────────────────────────────────────────────────
  const shown = hidden ? [] : drawings.map((d) => (preview?.id === d.id ? { ...d, points: preview.points } : d));
  const ghost = pending && (pending.kind === 'brush' ? pending.points : hover ? [pending.points[0], hover] : null);

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="absolute left-0 top-0 z-10 select-none"
        style={{ pointerEvents: capturing ? 'auto' : 'none', cursor: capturing ? 'crosshair' : undefined, touchAction: capturing ? 'none' : undefined }}
        onPointerDown={capturing ? onDown : undefined}
        onPointerMove={capturing ? onMove : undefined}
        onPointerUp={capturing ? onUp : undefined}
        onPointerLeave={capturing ? () => { setHover(null); chart.clearCrosshairPosition(); onHoverBar(null); } : undefined}
        aria-hidden="true"
        data-view={view}
        fontFamily={fontFamily}
      >
        <defs>
          <clipPath id="sx-plot"><rect x={0} y={0} width={plotW} height={height} /></clipPath>
          <marker id="sx-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill={DEFAULT_COLOR.arrow} />
          </marker>
          <marker id="sx-tip-up" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill={COLORS.up} /></marker>
          <marker id="sx-tip-down" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill={COLORS.down} /></marker>
        </defs>
        <g clipPath="url(#sx-plot)">
          {shown.map((d) => {
            const selected = d.id === selectedId;
            return (
              <g
                key={d.id}
                style={{ pointerEvents: locked ? 'none' : 'auto', cursor: locked ? undefined : d.locked ? 'pointer' : 'move' }}
                onPointerDown={(e) => beginDrag(e, d, null)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={d.kind === 'text' && !locked ? () => openEditor({ id: d.id, point: d.points[0], value: d.text ?? '' }) : undefined}
                data-drawing={d.kind}
                data-drawing-id={d.id}
                data-selected={selected || undefined}
              >
                <HitArea kind={d.kind} points={d.points} p={proj} text={d.text} selected={selected} />
                {editor?.id !== d.id && <g style={{ pointerEvents: 'none' }}><Shape kind={d.kind} points={d.points} color={d.color} p={proj} selected={selected} text={d.text} width={d.width} lineStyle={d.style} /></g>}
                {selected && !locked && !d.locked && d.kind !== 'brush' && d.kind !== 'text' && d.points.map((pt, i) => {
                  const hx = d.kind === 'hline' ? plotW / 2 : proj.x(pt.time);
                  const hy = d.kind === 'vline' ? height / 2 : proj.y(pt.price);
                  if (hx === null || hy === null) return null;
                  return (
                    <circle
                      key={i}
                      cx={hx}
                      cy={hy}
                      r={5}
                      fill={COLORS.bg}
                      stroke={d.color}
                      strokeWidth={2}
                      style={{ cursor: 'grab', pointerEvents: 'all' }}
                      onPointerDown={(e) => beginDrag(e, d, i)}
                    />
                  );
                })}
              </g>
            );
          })}
          {ghost && pending && <g opacity={0.8} style={{ pointerEvents: 'none' }}><Shape kind={pending.kind} points={ghost} color={DEFAULT_COLOR[pending.kind]} p={proj} selected={false} /></g>}
          {/* Magnet / crosshair helper for drawing tools */}
          {capturing && hover && (() => {
            const hx = proj.x(hover.time);
            const hy = proj.y(hover.price);
            return hx === null || hy === null ? null : <circle cx={hx} cy={hy} r={3.5} fill={magnet ? COLORS.alert : COLORS.text} style={{ pointerEvents: 'none' }} />;
          })()}
        </g>
      </svg>

      {(() => {
        const d = selectedId && !hidden && !preview && !editor ? drawings.find((x) => x.id === selectedId) : undefined;
        if (!d) return null;
        const box = bbox(d, proj);
        if (!box) return null;
        return (
          <DrawingContextBar
            key={d.id}
            drawing={d}
            anchor={box}
            plotW={plotW}
            height={height}
            onPatch={(patch) => onPatch(d.id, patch)}
            onClone={() => onClone(d.id)}
            onDelete={() => onDelete(d.id)}
          />
        );
      })()}

      {editor && (() => {
        const ex = proj.x(editor.point.time);
        const ey = proj.y(editor.point.price);
        if (ex === null || ey === null) return null;
        return (
          <input
            autoFocus
            aria-label="Text note"
            placeholder="Type a note, Enter to place"
            value={editor.value}
            maxLength={120}
            onChange={(e) => setEditor({ ...editor, value: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation(); // keep Esc / Delete away from the chart shortcuts
              if (e.key === 'Enter') commitText();
              else if (e.key === 'Escape') { editorDone.current = true; setEditor(null); if (!editor.id) onToolDone(); }
            }}
            onBlur={commitText}
            className="absolute z-30 h-6 w-56 rounded border border-solid border-sx-up/60 bg-[#0D0E11]/95 px-1.5 text-[13px] font-semibold text-sx-text outline-none"
            style={{ left: ex - 6, top: ey - TEXT_SIZE - 6, fontFamily }}
          />
        );
      })()}

      {/* Price-alert popups above their lines (same look as the chart card). */}
      {alertLines.map((l) => {
        const y = proj.y(l.price);
        if (y === null || y < 18 || y > height) return null;
        return (
          <div
            key={l.id}
            className="absolute left-2 z-20 flex items-center gap-1.5 rounded-md border border-solid border-sx-alert/50 bg-[#1A1710]/95 py-0.5 pl-2 pr-0.5 text-[11px] text-sx-alert shadow-lg shadow-black/40"
            style={{ top: y - 24 }}
          >
            <IconAlarm />
            <span className="font-semibold">Price alert</span>
            <span className="tabular-nums text-sx-text/80">{fmtPrice(l.price)}</span>
            {l.draft && <span className="rounded bg-sx-alert/15 px-1 text-[10px]">unsaved</span>}
            {!l.active && !l.draft && <span className="rounded bg-white/10 px-1 text-[10px] text-sx-muted">triggered</span>}
            <button type="button" className={`${BTN_RESET} grid h-5 w-5 place-items-center rounded hover:bg-sx-alert/15`} onClick={() => onAlertEdit(l.id)} aria-label="Edit alert" title="Edit alert"><IconPencil /></button>
            <button type="button" className={`${BTN_RESET} grid h-5 w-5 place-items-center rounded hover:bg-sx-down/20 hover:text-sx-down`} onClick={() => onAlertDelete(l.id)} aria-label="Delete alert" title="Delete alert"><IconTrash /></button>
          </div>
        );
      })}
    </>
  );
}

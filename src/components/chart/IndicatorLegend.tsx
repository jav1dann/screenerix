'use client';

/**
 * Legends over an `IndicatorLayer`'s panes: name, parameters and live values, with
 * hide / settings / remove buttons. Values are patched straight into the DOM on
 * crosshair moves and live ticks (no React render per frame); React re-renders
 * only when the indicator structure or the pane layout changes.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { MouseEventParams, Time } from 'lightweight-charts';
import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import { fmtCount, fmtPct, fmtPrice, fmtUsd, tone } from '@/lib/format';
import { formatValue } from '@/lib/indicators/engine';
import type { IndicatorLayer, LayerEntry } from '@/lib/indicators/engine';
import { removeIndicator, setVisible } from '@/lib/indicators/store';
import type { IndicatorScope } from '@/lib/indicators/store';
import { openIndicators } from '@/lib/indicators/ui';
import type { IndicatorWindow } from '@/lib/indicators/ui';
import type { ChartStats } from '@/lib/market/chartStream';
import { BTN_RESET } from './styles';

interface IndicatorLegendProps {
  layer: IndicatorLayer | null;
  wrapRef: RefObject<HTMLDivElement | null>;
  scope: IndicatorScope;
  win: IndicatorWindow | null;
  /** Live stats for the Market Data panel. */
  stats?: ChartStats | null;
  /** Read-only (Settings preview): no buttons. */
  readOnly?: boolean;
}

const MINI = `${BTN_RESET} grid h-4 w-4 shrink-0 place-items-center rounded text-sx-muted hover:bg-white/10 hover:text-sx-text`;

export default function IndicatorLegend({ layer, wrapRef, scope, win, stats, readOnly = false }: IndicatorLegendProps) {
  const [, setVersion] = useState(0);
  const [tops, setTops] = useState<number[]>([]);
  const spans = useRef(new Map<string, HTMLSpanElement>());
  const hovering = useRef(false);

  useEffect(() => {
    if (!layer) return undefined;
    const wrap = wrapRef.current;
    const measure = () => {
      if (!wrap) return;
      const top0 = wrap.getBoundingClientRect().top;
      const next = layer.getChart().panes().map((p) => (p.getHTMLElement()?.getBoundingClientRect().top ?? top0) - top0);
      setTops((prev) => (prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 0.5) ? prev : next));
    };
    const writeLast = () => {
      if (hovering.current) return;
      for (const e of layer.getEntries()) for (const o of e.outputs) {
        const el = spans.current.get(`${e.inst.uid}:${o.key}`);
        if (el) el.textContent = formatValue(e.def, e.last[o.key] ?? null);
      }
    };
    const ro = new ResizeObserver(() => { measure(); layer.relayout(); });
    if (wrap) ro.observe(wrap);
    const observePanes = () => layer.getChart().panes().forEach((p) => { const el = p.getHTMLElement(); if (el) ro.observe(el); });
    observePanes();
    const off = layer.onChange((kind) => {
      if (kind === 'structure') { setVersion((v) => v + 1); requestAnimationFrame(() => { measure(); observePanes(); writeLast(); }); }
      else writeLast();
    });
    const onMove = (param: MouseEventParams<Time>) => {
      hovering.current = param.time !== undefined && Boolean(param.point);
      if (!hovering.current) { writeLast(); return; }
      for (const e of layer.getEntries()) for (const o of e.outputs) {
        const el = spans.current.get(`${e.inst.uid}:${o.key}`);
        const s = e.series.get(o.key);
        if (!el || !s) continue;
        // Line / histogram points carry `value`; candle outputs (OI, CVD) their `close`.
        const d = param.seriesData.get(s) as { value?: number; close?: number } | undefined;
        const v = d ? (typeof d.value === 'number' ? d.value : typeof d.close === 'number' ? d.close : null) : null;
        el.textContent = formatValue(e.def, v);
      }
    };
    layer.getChart().subscribeCrosshairMove(onMove);
    requestAnimationFrame(() => { measure(); writeLast(); });
    return () => {
      off();
      ro.disconnect();
      try { layer.getChart().unsubscribeCrosshairMove(onMove); } catch { /* chart removed */ }
    };
  }, [layer, wrapRef]);

  if (!layer) return null;
  const entries = layer.getEntries();
  const byPane = new Map<number, LayerEntry[]>();
  for (const e of entries) {
    // Sub-indicators with nothing to draw here sit in the price pane's legend with their reason.
    const pane = e.pane ?? (e.note && e.def.placement === 'pane' ? 0 : null);
    if (pane !== null) byPane.set(pane, [...(byPane.get(pane) ?? []), e]);
  }
  const market = entries.find((e) => e.def.placement === 'panel' && e.inst.visible);
  const open = (focus: string | null = null) => openIndicators(scope, win, focus);

  const line = (e: LayerEntry) => (
    <div key={e.inst.uid} data-legend={e.def.id} className={`group/leg pointer-events-auto flex max-w-full items-center gap-1.5 rounded px-1 py-px text-[10px] leading-4 ${e.inst.visible ? '' : 'opacity-50'} hover:bg-[#0B0C0E]/80`}>
      <span className="shrink-0 font-semibold text-sx-text">{e.def.name}</span>
      {e.inst.params.length > 0 && <span className="shrink-0 text-sx-muted @max-[18rem]:hidden">{e.inst.params.join(' ')}</span>}
      {e.note ? <span className="truncate text-[#6B6E78]">{e.note}</span> : e.inst.visible && e.outputs.map((o) => (
        <span key={o.key} className="flex shrink-0 items-center gap-0.5 tabular-nums @max-[18rem]:hidden">
          {e.outputs.length > 1 && <span style={{ color: o.color }} className="opacity-80">{o.label}</span>}
          <span ref={(el) => { const k = `${e.inst.uid}:${o.key}`; if (el) spans.current.set(k, el); else spans.current.delete(k); }} style={{ color: o.colorBy ? undefined : o.color }} className={o.colorBy ? 'text-sx-text' : undefined}>—</span>
        </span>
      ))}
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/leg:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          <button type="button" className={MINI} onClick={() => setVisible(scope, e.inst.uid, !e.inst.visible)} aria-label={e.inst.visible ? `Hide ${e.def.name}` : `Show ${e.def.name}`} title={e.inst.visible ? 'Hide' : 'Show'}>
            {e.inst.visible ? <Eye size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />}
          </button>
          {e.def.params.length > 0 && (
            <button type="button" className={MINI} onClick={() => open(e.inst.uid)} aria-label={`${e.def.name} settings`} title="Settings"><Settings2 size={11} aria-hidden="true" /></button>
          )}
          <button type="button" className={`${MINI} hover:text-sx-down`} onClick={() => removeIndicator(scope, e.inst.uid)} aria-label={`Remove ${e.def.name}`} title="Remove"><X size={11} aria-hidden="true" /></button>
        </span>
      )}
    </div>
  );

  const lastPane = Math.max(0, ...[...byPane.keys()]);
  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-indicator-legend>
      {[...byPane].map(([pane, list]) => {
        const shown = list;
        return (
          <div key={pane} data-legend-pane={pane} className="absolute left-1 right-16 flex flex-col items-start" style={{ top: (tops[pane] ?? 0) + 2 }}>
            {shown.map(line)}
            {pane === lastPane && layer.overflow > 0 && !readOnly && (
              <button type="button" onClick={() => open()} className={`${BTN_RESET} pointer-events-auto mt-0.5 rounded bg-white/[0.08] px-1.5 text-[10px] font-semibold text-sx-muted hover:text-sx-text`} title="More indicators than fit this chart — open the list">
                +{layer.overflow} more
              </button>
            )}
          </div>
        );
      })}
      {market && <MarketDataPanel stats={stats ?? null} note={market.note} top={tops[0] ?? 0} />}
    </div>
  );
}

function MarketDataPanel({ stats, note, top }: { stats: ChartStats | null; note: string | null; top: number }) {
  const rows: Array<[string, string, string | undefined]> = stats ? [
    ['Last', stats.last === null ? '—' : fmtPrice(stats.last), undefined],
    ['24h', stats.change24h === null ? '—' : fmtPct(stats.change24h), stats.change24h === null ? undefined : tone(stats.change24h)],
    ['Range', stats.range24h === null ? '—' : fmtPct(stats.range24h).replace('+', ''), undefined],
    ['Volume', stats.volume24h === null ? '—' : fmtUsd(stats.volume24h), undefined],
    ['Trades', stats.trades24h === null ? '—' : fmtCount(stats.trades24h), undefined],
  ] : [];
  return (
    <div data-market-data className="absolute right-16 rounded-md border border-solid border-sx-line bg-[#0B0C0E]/85 px-2 py-1 text-[10px] leading-4 @max-[18rem]:hidden" style={{ top: top + 4 }}>
      {note || !stats ? <span className="text-[#6B6E78]">{note ?? 'Market data unavailable'}</span> : rows.map(([k, v, c]) => (
        <div key={k} className="flex justify-between gap-3 tabular-nums"><span className="text-sx-muted">{k}</span><span style={c ? { color: c } : undefined} className="font-semibold text-sx-text">{v}</span></div>
      ))}
    </div>
  );
}

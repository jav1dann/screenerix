'use client';

/**
 * Screenerix — single-coin chart workspace.
 *
 *   <ChartWorkspace symbol="CFX" exchange="binance" />                    // embedded (Market Review)
 *   <ChartWorkspace symbol="CFX" exchange="binance" onClose={…} modal />  // inside ExpandedChartModal
 *
 * TradingView-style view of one coin: timeframe selector (1s → 1d), live
 * OHLCV line, drawing rail (incl. text notes and go-to-date), indicators
 * from the Indicator modal (overlays, densities, OI and other sub-panes),
 * alerts, snapshot and fullscreen. It reads the shared `chartStream`, so a
 * chart card on the same timeframe reuses the live subscription, and a new
 * `symbol` swaps the data in place (no remount).
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAlerts } from '@/hooks/useAlerts';
import { useChartStream } from '@/hooks/useChartStream';
import { useChartPrefs, useDrawings } from '@/hooks/useTerminal';
import { openIndicators } from '@/lib/indicators/ui';
import type { MarketType } from '@/lib/alerts/alertStore';
import { alertsUi } from '@/lib/alerts/alertsUi';
import { removeAllDrawings, removeDrawing, upsertDrawing } from '@/lib/drawings/drawingStore';
import { DEFAULT_COLOR } from '@/lib/drawings/types';
import type { DrawPoint, DrawingKind } from '@/lib/drawings/types';
import { fmtDateTime } from '@/lib/format';
import { ADAPTERS, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ChartTimeframe, ExchangeId, RawCandle } from '@/lib/market/exchanges';
import { alertLines as linesFor, DRAFT_ID, deleteAlertLine, editAlertLine, moveAlertLineTo, saveDraftLine, tickerOf, venueMarket } from '../alertForm';
import type { AlertLine } from '../ChartCanvas';
import { GHOST_BTN } from '../styles';
import AdvancedChart from './AdvancedChart';
import type { AdvancedChartControls, ChartLevel } from './AdvancedChart';
import type { DrawingPatch } from './DrawingLayer';
import DrawingToolbar from './DrawingToolbar';
import ExpandedHeader from './ExpandedHeader';
import { isCursor } from './tools';
import type { Tool } from './tools';

import type { TradeLevels } from '@/lib/strategies/chartLines';

export interface ChartWorkspaceProps {
  symbol: string;
  exchange: ExchangeId;
  marketType?: MarketType;
  /** Defaults to the last timeframe used in the terminal. */
  initialInterval?: ChartTimeframe;
  /** Modal only: shows the close button; Escape (anywhere) closes. */
  onClose?: () => void;
  /** Rendered as the expanded-chart dialog. */
  modal?: boolean;
  /** Order-book walls drawn as price lines. */
  levels?: readonly ChartLevel[];
  /** A strategy formation's Entry / SL / TP1 / TP2. */
  tradeLevels?: TradeLevels | null;
  /** Live funding rate (fraction) for the header; omit where it isn't known (spot, modals). */
  funding?: number | null;
  className?: string;
}

const TOAST_MS = 5_000;

export default function ChartWorkspace({ symbol, exchange, marketType, initialInterval, onClose, modal = false, levels, tradeLevels = null, funding, className = '' }: ChartWorkspaceProps) {
  const [prefs, updatePrefs] = useChartPrefs();
  const [tf, setTf] = useState<ChartTimeframe>(() => initialInterval ?? prefs.tf);
  // Starts on (and returns to) the user's cursor tool: Cross, Dot or Arrow, persisted in chart prefs.
  const [tool, setTool] = useState<Tool>(() => prefs.cursor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<RawCandle | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const controls = useRef<AdvancedChartControls | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A new coin keeps the timeframe and tool, but not the per-coin selection / alert draft.
  const coinKey = `${exchange}:${symbol}`;
  const [shownKey, setShownKey] = useState(coinKey);
  if (shownKey !== coinKey) {
    setShownKey(coinKey);
    setSelectedId(null);
    setDraft(null);
    setHover(null);
  }

  const market = marketType ?? venueMarket(exchange);
  const adapter = ADAPTERS[exchange];
  const { stream, snapshot } = useChartStream(exchange, symbol, tf);
  const drawings = useDrawings(exchange, symbol);
  const alerts = useAlerts(exchange, symbol);
  const ticker = tickerOf(snapshot.meta, symbol, exchange);
  const displayTicker = `${ticker}${market === 'futures' ? '.P' : ''}`;

  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  /* ── Alerts (checked on the server; lines for the active price alerts, edited in the alert wizard) ── */
  const alertLines: AlertLine[] = linesFor(alerts, draft);
  // The alert tool places a line at the clicked price; Save (on the line) makes it a real alert,
  // Edit opens the wizard for more options. Lines can be dragged.
  const pickAlert = (price: number) => setDraft(price);
  const lastPrice = () => stream.getCandles().at(-1)?.c ?? null;
  const saveAlertLine = () => saveDraftLine(draft, exchange, symbol, lastPrice(), () => setDraft(null));
  const moveAlert = (id: string, price: number) => moveAlertLineTo(id, price, lastPrice(), setDraft);
  const editAlert = (id: string) => { if (editAlertLine(id, draft, alerts, exchange, symbol) && id === DRAFT_ID) setDraft(null); };
  const deleteAlert = (id: string) => { if (id === DRAFT_ID) setDraft(null); else deleteAlertLine(id); };

  /* ── Drawings ── */
  const createDrawing = (kind: DrawingKind, points: DrawPoint[], text?: string) => {
    const id = crypto.randomUUID();
    upsertDrawing({ id, exchange, symbol, kind, points, color: DEFAULT_COLOR[kind], ...(text === undefined ? {} : { text }), createdAt: Date.now() });
    setSelectedId(id);
  };
  const updateDrawing = (id: string, points: DrawPoint[]) => {
    const d = drawings.find((x) => x.id === id);
    if (d) upsertDrawing({ ...d, points });
  };
  const editText = (id: string, text: string) => {
    const d = drawings.find((x) => x.id === id);
    if (!d) return;
    if (text) upsertDrawing({ ...d, text });
    else { removeDrawing(id); if (selectedId === id) setSelectedId(null); }
  };
  const removeSelected = () => { if (selectedId) { removeDrawing(selectedId); setSelectedId(null); } };
  const deleteDrawing = (id: string) => { removeDrawing(id); if (selectedId === id) setSelectedId(null); };
  const patchDrawing = (id: string, patch: DrawingPatch) => {
    const d = drawings.find((x) => x.id === id);
    if (d) upsertDrawing({ ...d, ...patch });
  };
  /** A copy shifted 5 bars right (so it doesn't hide the original), selected. */
  const cloneDrawing = (id: string) => {
    const d = drawings.find((x) => x.id === id);
    if (!d) return;
    const shift = 5 * TIMEFRAME_MS[tf];
    const copy = { ...d, id: crypto.randomUUID(), locked: false, points: d.points.map((p) => ({ ...p, time: p.time + shift })), createdAt: Date.now() };
    upsertDrawing(copy);
    setSelectedId(copy.id);
  };

  const changeTf = (next: ChartTimeframe) => { setTf(next); setHover(null); updatePrefs({ tf: next }); };

  const goTo = async (ms: number) => {
    const r = await controls.current?.goTo(ms);
    if (r && !r.reached && r.earliest !== null) showToast(`Earliest available: ${fmtDateTime(r.earliest)}`);
  };

  /* ── Keyboard: Esc unwinds (drawing → tool → selection → close); Delete removes the selection ── */
  const handleKey = (e: KeyboardEvent | ReactKeyboardEvent) => {
    if (alertsUi.getSnapshot().wizard) return; // the alert wizard handles its own keys
    const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (controls.current?.cancelPending()) { e.preventDefault(); return; }
      if (!isCursor(tool)) { e.preventDefault(); setTool(prefs.cursor); return; }
      if (selectedId) { e.preventDefault(); setSelectedId(null); return; }
      if (document.fullscreenElement || !onClose) return; // the browser exits fullscreen first
      e.preventDefault();
      onClose();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !prefs.locked && !typing) {
      e.preventDefault();
      removeSelected();
    } else if (e.altKey && e.code === 'KeyT' && !typing) {
      e.preventDefault();
      setTool('trend');
      setSelectedId(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedId && !prefs.locked && !typing) {
      e.preventDefault();
      cloneDrawing(selectedId);
    }
  };
  // The modal owns the keyboard; an embedded workspace reacts while focus is inside it,
  // or anywhere while one of its drawings is selected (the click that selected it may not focus it).
  const onWindowKey = useEffectEvent((e: KeyboardEvent) => {
    if (!modal && rootRef.current?.contains(e.target as Node)) return; // handled by onKeyDown
    handleKey(e);
  });
  const hasSelection = selectedId !== null;
  useEffect(() => {
    if (!modal && !hasSelection) return undefined;
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [modal, hasSelection]);

  /* ── Focus in (modal), fullscreen tracking ── */
  useEffect(() => {
    const root = rootRef.current;
    if (modal) root?.focus();
    const onFs = () => setFullscreen(document.fullscreenElement === root);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (root && document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      clearTimeout(toastTimer.current);
    };
  }, [modal]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };
  const snapshotPng = () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    void controls.current?.snapshot(`${displayTicker}_${tf}_${stamp}.png`);
  };

  const bars = stream.getCandles();
  const liveBar = bars.length ? bars[bars.length - 1] : null;
  const win = { exchange, market, symbol };
  const overlay = snapshot.status === 'unlisted' ? `${symbol} isn’t listed on ${adapter.name}.`
    : snapshot.status === 'error' ? (snapshot.error ?? 'Market data unavailable')
    : snapshot.status === 'loading' ? `Loading ${displayTicker} · ${tf}…`
    : null;

  const frame = modal
    ? `absolute border-solid border-sx-line2 shadow-2xl shadow-black/70 ${fullscreen ? 'inset-0 rounded-none border-0' : 'inset-0 rounded-none border-0 sm:inset-3 sm:rounded-2xl sm:border'}`
    : `relative h-full rounded-xl border border-solid border-sx-line ${fullscreen ? 'rounded-none border-0' : ''}`;

  return (
    <>
      <div
        ref={rootRef}
        {...(modal ? { role: 'dialog', 'aria-modal': true } : { role: 'region' })}
        aria-label={`${displayTicker} chart`}
        tabIndex={-1}
        onKeyDown={modal ? undefined : handleKey}
        data-chart-workspace={modal ? 'modal' : 'embedded'}
        className={`flex flex-col overflow-hidden bg-[#0D0E11] text-sx-text outline-none [&_*]:box-border ${frame} ${className}`}
      >
        <ExpandedHeader
          displayTicker={displayTicker}
          exchangeName={adapter.name}
          exchange={win.exchange}
          marketLabel={market === 'futures' ? 'Futures' : 'Spot'}
          conn={snapshot.conn}
          tf={tf}
          onTf={changeTf}
          bar={hover ?? liveBar}
          hovering={hover !== null}
          change24h={snapshot.stats.change24h}
          funding={market === 'futures' ? funding : undefined}
          prefs={prefs}
          updatePrefs={updatePrefs}
          onIndicators={() => openIndicators('chart', win)}
          onSnapshot={snapshotPng}
          statsCollapsed={prefs.expandedStatsCollapsed}
          onToggleStats={() => updatePrefs({ expandedStatsCollapsed: !prefs.expandedStatsCollapsed })}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
          onClose={onClose}
        />
        <div className="flex min-h-0 flex-1">
          <DrawingToolbar
            tool={tool}
            cursor={prefs.cursor}
            onTool={(t) => { setTool(t); if (isCursor(t)) updatePrefs({ cursor: t }); else setSelectedId(null); }}
            magnet={prefs.magnet}
            onMagnet={() => updatePrefs({ magnet: !prefs.magnet })}
            locked={prefs.locked}
            onLock={() => { updatePrefs({ locked: !prefs.locked }); setSelectedId(null); }}
            hidden={prefs.hidden}
            onHide={() => { updatePrefs({ hidden: !prefs.hidden }); setSelectedId(null); }}
            hasSelection={selectedId !== null}
            drawingCount={drawings.length}
            onRemoveSelected={removeSelected}
            onRemoveAll={() => { removeAllDrawings(exchange, symbol); setSelectedId(null); }}
            onGoTo={(ms) => void goTo(ms)}
          />
          <div className="relative min-w-0 flex-1">
            <AdvancedChart
              stream={stream}
              win={win}
              stats={snapshot.stats}
              symbol={symbol}
              prefs={prefs}
              tool={tool}
              onToolDone={() => setTool(prefs.cursor)}
              drawings={drawings}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={createDrawing}
              onUpdate={updateDrawing}
              onEditText={editText}
              onPatch={patchDrawing}
              onDelete={deleteDrawing}
              onClone={cloneDrawing}
              alertLines={alertLines}
              levels={levels}
              tradeLevels={tradeLevels}
              onAlertPick={pickAlert}
              onAlertEdit={editAlert}
              onAlertDelete={deleteAlert}
              onAlertSave={saveAlertLine}
              onAlertMove={moveAlert}
              onHover={setHover}
              controls={controls}
            />
            {overlay && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#0D0E11]/75 p-4 text-center text-sm text-sx-muted">
                <span>{overlay}</span>
                {snapshot.status === 'error' && <button type="button" className={GHOST_BTN} onClick={() => stream.retry()}>Retry</button>}
              </div>
            )}
            {toast && (
              <div role="status" className="absolute right-16 top-3 z-30 rounded-lg border border-solid border-sx-alert/50 bg-[#1A1710]/95 px-3 py-2 text-xs font-semibold text-sx-alert shadow-lg shadow-black/40">
                {toast}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

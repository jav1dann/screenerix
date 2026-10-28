'use client';

/**
 * Screenerix — reusable live chart card.
 *
 *   <Chart symbol="STRK" exchange="binance" />
 *
 * Same template for every coin and venue: candles + volume streamed from the
 * exchange WebSocket, 5m / daily stats, copy / pin / external-terminal tools,
 * hover tooltip, click-to-place price alerts with a 3-step editor, and an
 * Expand button that opens the full terminal (`ExpandedChartModal`).
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAlerts, usePinned } from '@/hooks/useAlerts';
import { useChartStream } from '@/hooks/useChartStream';
import { useChartPrefs } from '@/hooks/useTerminal';
import type { MarketType } from '@/lib/alerts/alertStore';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ChartTimeframe, ExchangeId } from '@/lib/market/exchanges';
import type { SortPref } from '@/lib/settings/settings';
import { alertLines, DRAFT_ID, deleteAlertLine, editAlertLine, moveAlertLineTo, saveDraftLine, tickerOf, venueMarket } from './alertForm';
import ChartCanvas from './ChartCanvas';
import type { AlertLine } from './ChartCanvas';
import ChartHeader from './ChartHeader';
import ChartToolbar from './ChartToolbar';
import ExpandedChartModal from './expanded/ExpandedChartModal';
import { GHOST_BTN } from './styles';
import type { TerminalLinkContext } from './terminalLinks';
import { openIndicators } from '@/lib/indicators/ui';
import type { TradeLevels } from '@/lib/strategies/chartLines';

export interface ChartProps {
  /** Base coin, e.g. "STRK". */
  symbol: string;
  exchange: ExchangeId;
  /** Defaults to what the venue offers (futures; spot on Coinbase). */
  marketType?: MarketType;
  interval?: ChartTimeframe;
  /** Market Map sort, for the header's "Sort metric" indicator. Default 5m Range. */
  sort?: SortPref;
  /** Server-scanned metric values of this coin (header indicators). */
  metrics?: Readonly<Record<string, number | null | undefined>>;
  /** Live funding rate (fraction) for the header's fixed "Fund." value; omit on spot or where it isn't known. */
  funding?: number | null;
  /** Card height (px, or any CSS length such as '100%' to fill a grid cell). */
  height?: number | string;
  onSettingsClick?: () => void;
  onPinChange?: (pinned: boolean, ctx: TerminalLinkContext) => void;
  /** Show the Expand button (opens the full terminal). Default true. */
  expandable?: boolean;
  /** Override what Expand does (e.g. route to a dedicated page) instead of opening the built-in modal. */
  onExpand?: () => void;
  className?: string;
  /**
   * Read-only preview (Settings modal): same look, live data and settings, but nothing
   * that changes real state — no Expand, alerts, pin, collapse; toolbar buttons are inert.
   */
  preview?: boolean;
  /** A strategy formation's Entry / SL / TP1 / TP2, drawn on the card and the expanded chart. */
  tradeLevels?: TradeLevels | null;
  /** Overlay near the chart's bottom-left corner (e.g. the formation's stage badge). */
  badge?: ReactNode;
  /**
   * True while the card is in use — its expanded chart or alert editor is open — so a
   * live grid keeps it in place (re-ranking would unmount it and close the modal).
   */
  onHoldChange?: (held: boolean) => void;
}

const DEFAULT_SORT: SortPref = { mode: 'range', window: '5m' };
const NO_LINES: AlertLine[] = [];
const noop = () => {};

export default function Chart(props: ChartProps) {
  const { exchange, marketType, className = '', height = 360 } = props;
  const supported = venueMarket(exchange);
  const shell = `@container box-border flex flex-col overflow-hidden rounded-xl border border-solid border-sx-line bg-[rgba(17,18,21,0.62)] text-sx-text backdrop-blur-xl [&_*]:box-border ${className}`;

  if (marketType && marketType !== supported) {
    return (
      <div className={`${shell} items-center justify-center p-6 text-center text-sm text-sx-muted`} style={{ height }}>
        {props.symbol} {marketType === 'spot' ? 'Spot' : 'Futures'} isn’t available on {ADAPTERS[exchange].name} yet.
      </div>
    );
  }
  return <LiveChart {...props} marketType={supported} shell={shell} height={height} />;
}

function LiveChart({
  symbol, exchange, marketType, interval = '1m', sort = DEFAULT_SORT, metrics, funding, height,
  onSettingsClick, onPinChange, expandable = true, onExpand, shell, preview = false, tradeLevels = null, badge, onHoldChange,
}: ChartProps & { marketType: MarketType; height: number | string; shell: string }) {
  const { stream, snapshot } = useChartStream(exchange, symbol, interval);
  const alerts = useAlerts(exchange, symbol);
  const [pinned, setPinned] = usePinned(exchange, symbol);
  const [draft, setDraft] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [{ cardHeaderCollapsed }, updatePrefs] = useChartPrefs();
  const inUse = expanded;
  const holdRef = useRef(onHoldChange);
  useEffect(() => { holdRef.current = onHoldChange; });
  useEffect(() => {
    holdRef.current?.(inUse);
  }, [inUse]);
  useEffect(() => () => holdRef.current?.(false), []);

  const adapter = ADAPTERS[exchange];
  const ticker = tickerOf(snapshot.meta, symbol, exchange);
  const ctx: TerminalLinkContext = { exchange, marketType, symbol, ticker };

  const lines: AlertLine[] = alertLines(alerts, draft);
  // Edit opens the alert wizard (prefilled); the draft line goes away once it's handed over.
  const edit = (id: string) => { if (editAlertLine(id, draft, alerts, exchange, symbol) && id === DRAFT_ID) setDraft(null); };
  const remove = (id: string) => { if (id === DRAFT_ID) setDraft(null); else deleteAlertLine(id); };
  // Save turns the clicked line into a real alert; dragging a line moves it (saved alerts on the server).
  const saveLine = () => saveDraftLine(draft, exchange, symbol, snapshot.stats.last, () => setDraft(null));
  const moveLine = (id: string, price: number) => moveAlertLineTo(id, price, snapshot.stats.last, setDraft);

  const expand = expandable && !preview ? (onExpand ?? (() => setExpanded(true))) : undefined;

  const overlay = (() => {
    if (snapshot.status === 'unlisted') return `${symbol} isn’t listed on ${adapter.name} ${marketType === 'futures' ? 'Futures' : 'Spot'}.`;
    if (snapshot.status === 'error') return snapshot.error ?? 'Market data unavailable';
    if (snapshot.status === 'loading') return `Loading ${symbol} from ${adapter.name}…`;
    return null;
  })();

  return (
    <div className={shell} style={{ height }}>
      <ChartHeader
        symbol={symbol}
        quote={adapter.quote}
        venueLabel={`${adapter.name} · ${marketType === 'futures' ? 'Futures' : 'Spot'} · ${interval}`}
        stats={snapshot.stats}
        sort={sort}
        metrics={metrics}
        exchange={exchange}
        funding={marketType === 'futures' ? funding : undefined}
        conn={snapshot.conn}
        onSettingsClick={onSettingsClick}
        onExpand={expand}
        onIndicators={preview ? undefined : () => openIndicators('card', { exchange, market: marketType, symbol })}
        collapsed={!preview && cardHeaderCollapsed}
        onToggleCollapsed={preview ? undefined : () => updatePrefs({ cardHeaderCollapsed: !cardHeaderCollapsed })}
      />
      <div className="flex min-h-0 flex-1">
        <ChartToolbar
          ctx={ctx}
          pinned={pinned}
          onTogglePin={() => { setPinned(!pinned); onPinChange?.(!pinned, ctx); }}
          preview={preview}
        />
        <div className="relative min-w-0 flex-1">
          <ChartCanvas stream={stream} symbol={symbol} instrument={`${adapter.name} · ${marketType === 'futures' ? 'Futures' : 'Spot'}`.toUpperCase()} win={{ exchange, market: marketType, symbol }} stats={snapshot.stats} readOnly={preview} tradeLevels={tradeLevels} badge={badge} lines={preview ? NO_LINES : lines} onPick={preview ? noop : setDraft} onEdit={edit} onDelete={remove} onSave={saveLine} onMove={moveLine} />
          {overlay && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#0B0C0E]/70 p-4 text-center text-xs text-sx-muted">
              <span>{overlay}</span>
              {snapshot.status === 'error' && <button type="button" className={GHOST_BTN} onClick={() => stream.retry()}>Retry</button>}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <ExpandedChartModal
          symbol={symbol}
          exchange={exchange}
          marketType={marketType}
          initialInterval={interval}
          tradeLevels={tradeLevels}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

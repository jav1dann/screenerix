'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { FunnelPlus, X } from 'lucide-react';
import Chart from '@/components/chart/Chart';
import type { Timeframe } from '@/lib/market/exchanges';
import { gridLayout } from '@/lib/market/terminalPrefs';
import type { GridCount } from '@/lib/market/terminalPrefs';
import type { Asset, ExchangeId } from '@/lib/market/types';
import { useStableSlots } from '@/hooks/useScreener';
import { LIQUID_MIN } from '@/lib/screener/defaultRanking';
import type { ScanSnapshot } from '@/lib/screener/rank';
import type { Ranked } from '@/lib/screener/slots';
import { sortLabel } from '@/lib/settings/settings';
import type { SortPref } from '@/lib/settings/settings';
import { h3, sectionTitle } from '../styles';
import SafeBoundary from '@/components/shared/SafeBoundary';
import FeedUnavailable from '../FeedUnavailable';
import type { FeedProblem } from '../FeedUnavailable';

interface MarketMapProps {
  market: Asset[];
  exchange: ExchangeId;
  /** Header sort (default ranking without a filter; also the cards' "Sort metric" indicator). */
  sort: SortPref;
  /** Server metric values per symbol (card indicators). */
  metrics: ReadonlyMap<string, Readonly<Record<string, number | null>>>;
  /** Timeframe of the chart cards. */
  tf: Timeframe;
  /** Grid layout: number of cards (columns × rows come from the layout). */
  grid: GridCount;
  /**
   * Live ranking driving the cards: the enabled filter's matches, or (no filter)
   * liquid coins by the header sort.
   */
  scan: ScanSnapshot;
  /** Sort direction of `scan.matches`. */
  dir: 'desc' | 'asc';
  /** Enabled screener filter (chip + paused notice). */
  screen?: MapScreen | null;
  /** The exchange's market feed failed (shown instead of "waiting", with Retry; it also retries by itself). */
  unavailable?: FeedProblem | null;
}

export interface MapScreen {
  name: string;
  scan: ScanSnapshot;
  /** Set when the filter targets another venue / market than the one shown. */
  mismatch?: { label: string; onApply: () => void };
  onClear: () => void;
}

/**
 * Responsive columns: 1 on phones, up to 2 from `md`, the layout's full column count from `xl`.
 * On `xl` the rows stretch to fill the viewport below the header (min 220px per row).
 */
const GRID = [
  'grid gap-2.5 grid-cols-1',
  'md:grid-cols-[repeat(var(--cols-md),minmax(0,1fr))]',
  'xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]',
].join(' ');
const FILL = 'auto-rows-[300px] xl:auto-rows-auto xl:grid-rows-[repeat(var(--rows),minmax(220px,1fr))] xl:h-[calc(100vh-172px)]';
/** Grids taller than the viewport (5×5, 5×10): fixed-height rows and page scroll. */
const SCROLL = 'auto-rows-[300px] xl:auto-rows-[260px]';
/** Above this many cards, charts mount only near the viewport (each one streams live data). */
const LAZY_FROM = 17;

/** Mounts `children` only while the cell is within ~1 screen of the viewport. */
function LazyCell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="min-h-0 min-w-0" data-lazy={near ? 'mounted' : 'idle'}>
      {near ? children : <div className="sx-glass sx-skeleton h-full" />}
    </div>
  );
}

export default function MarketMap({ market, exchange, sort, metrics, tf, grid, scan, dir, screen, unavailable }: MarketMapProps) {
  const layout = gridLayout(grid);
  const filtering = Boolean(screen && !screen.mismatch);
  const bySymbol = new Map(market.map((a) => [a.symbol, a]));
  // The ranking, best first. Without a filter, liquid coins not scored yet trail
  // with a null score: they hold empty cards during warm-up and lose to any scored coin.
  const scored = scan.matches.filter((m) => bySymbol.has(m.symbol));
  let ranked: Ranked[] = scored;
  if (!filtering) {
    const seen = new Set(scored.map((m) => m.symbol));
    ranked = [...scored, ...market.filter((a) => a.volume >= LIQUID_MIN && !seen.has(a.symbol)).map((a) => ({ symbol: a.symbol, score: null }))];
  }
  // Cards in use (hovered, expanded, alert editor open) keep their slot through re-ranking.
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const hold = useCallback((symbol: string, reason: string, on: boolean) => {
    const key = `${symbol}\u0000${reason}`;
    setHeld((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const heldSymbols = new Set([...held].map((k) => k.split('\u0000')[0]));
  // One live screen: the top N coins in stable slots (swaps every ~5s, vacancies fill at once).
  const slots = useStableSlots(ranked, layout.count, dir, `${scan.filterId}|${exchange}|${layout.count}`, heldSymbols);
  const tiles = slots.flatMap((sym) => bySymbol.get(sym) ?? []);
  const scanning = scan.scanned < scan.candidates;
  const vars = { '--cols': layout.cols, '--cols-md': Math.min(2, layout.cols), '--rows': layout.rows } as CSSProperties;
  const shown = String(tiles.length);
  const lazy = layout.count >= LAZY_FROM;
  const tall = layout.rows > 4;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sectionTitle}>
        <h3 style={h3}>Market Map</h3>
        {screen ? <ScreenChip screen={screen} /> : (
          <span className="sx-muted tabular-nums" style={{ fontSize: 12 }} aria-live="polite">
            {shown} live charts · {tf} · top {sortLabel(sort)} · coins ≥ ${LIQUID_MIN / 1e6}M 24h{scanning && scan.candidates ? ` · ranking ${scan.scanned} / ${scan.candidates}` : ''}
            {scan.skipped.length > 0 && <span title={scan.skipped.join(', ')}> · not available on this exchange — showing by volume</span>}
          </span>
        )}
      </div>
      {tiles.length === 0 && (
        <div className="sx-glass sx-skeleton" style={{ height: 160 }}>
          {unavailable ? (
            <FeedUnavailable problem={unavailable} />
          ) : !filtering || !screen ? 'Waiting for market data…'
            : screen.scan.scanned < screen.scan.candidates ? `Scanning ${screen.name}… ${screen.scan.scanned} / ${screen.scan.candidates} coins checked`
            : `No coins match “${screen.name}” right now.`}
        </div>
      )}
      <div className={`${GRID} ${tall ? SCROLL : FILL}`} style={vars} data-grid={`${layout.cols}x${layout.rows}`}>
        {tiles.map((a) => {
          const card = (
            <div
              key={`${exchange}:${a.symbol}`}
              className="h-full min-h-0 min-w-0"
              data-held={heldSymbols.has(a.symbol) || undefined}
              onPointerEnter={() => hold(a.symbol, 'hover', true)}
              onPointerLeave={() => hold(a.symbol, 'hover', false)}
            >
              {/* One failing chart shows its error in its own cell; the rest of the map keeps running. */}
              <SafeBoundary name={`${a.symbol} chart`} compact>
                <Chart symbol={a.symbol} exchange={exchange} interval={tf} sort={sort} metrics={metrics.get(a.symbol)} funding={a.funding} height="100%" onHoldChange={(on) => hold(a.symbol, 'open', on)} />
              </SafeBoundary>
            </div>
          );
          return lazy ? <LazyCell key={`${exchange}:${a.symbol}`}>{card}</LazyCell> : card;
        })}
      </div>
    </div>
  );
}

function ScreenChip({ screen }: { screen: MapScreen }) {
  const { scan } = screen;
  const scanning = scan.scanned < scan.candidates;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-solid border-sx-up/40 bg-sx-up/10 py-0.5 pl-2.5 pr-1 font-semibold text-sx-up">
        <FunnelPlus size={12} aria-hidden="true" />
        <span className="max-w-40 truncate">{screen.name}</span>
        <button type="button" onClick={screen.onClear} aria-label={`Turn off filter ${screen.name}`} title="Turn off filter" className="grid h-4 w-4 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-sx-up hover:bg-sx-up/20">
          <X size={11} aria-hidden="true" />
        </button>
      </span>
      {screen.mismatch ? (
        <span className="sx-muted">
          Paused — this filter is for {screen.mismatch.label}.{' '}
          <button type="button" onClick={screen.mismatch.onApply} className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-xs font-semibold text-sx-text underline underline-offset-2">Switch</button>
        </span>
      ) : (
        <span className="sx-muted tabular-nums" aria-live="polite">
          {scan.matches.length} match{scan.matches.length === 1 ? '' : 'es'}
          {scanning ? ` · scanning ${scan.scanned} / ${scan.candidates}` : ` of ${scan.total} coins`}
          {scan.skipped.length > 0 && <span title={`Not available on this exchange: ${scan.skipped.join(', ')}`}> · {scan.skipped.length} condition{scan.skipped.length === 1 ? '' : 's'} skipped</span>}
        </span>
      )}
    </span>
  );
}

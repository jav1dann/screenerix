'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, UIEvent } from 'react';
import { ChevronLeft, ChevronRight, FunnelPlus, Palette, Settings, Star, X } from 'lucide-react';
import { IconSearch } from '@/components/shared/icons';
import { useColorRules } from '@/hooks/useTerminal';
import { fmtPct, fmtUsd, tone } from '@/lib/format';
import { ruleColor } from '@/lib/screener/colorRules';
import { ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { SortDir, SortKey, TickerRow, VenueStatus } from '@/lib/market/types';
import { toggleIn, watchlistStore } from '@/lib/settings/settings';
import { openSettings } from '@/lib/settings/settingsUi';
import { COLORS } from '@/lib/theme';
import { DropdownSelect } from './MarketControls';

/** Fixed row height lets the list render only what's on screen (venues list 400–1000 symbols). */
const ROW_H = 32;
const OVERSCAN = 10;
const WIDTH = 380;
const RAIL_W = 44;

/** Windowed rendering for a fixed-height list inside a scroll container. */
function useWindow(count: number, rowH: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 900 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowH]);
  const onScroll = (e: UIEvent<HTMLDivElement>) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
  const first = Math.max(0, Math.floor(view.top / rowH) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.top + view.height) / rowH) + OVERSCAN);
  return { ref, onScroll, first, last, padTop: first * rowH, padBottom: Math.max(0, count - last) * rowH };
}

const TICKER_COLS = 'minmax(0,1.2fr) minmax(0,0.85fr) minmax(0,0.8fr) minmax(0,0.85fr) minmax(0,0.9fr)';
const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'sym', label: 'Symbol', align: 'left' },
  { key: 'ch24', label: '24h (%)', align: 'right' },
  { key: 'natr', label: 'NATR', align: 'right' },
  { key: 'fund', label: 'Fund.', align: 'right' },
  { key: 'vol', label: '24h ($)', align: 'right' },
];

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  rows: TickerRow[];
  total: number;
  activeSymbol: string;
  onPick: (symbol: string) => void;
  query: string;
  onQuery: (q: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  /** Primary venue (each venue is one market: Futures or Spot). */
  venue: ExchangeId;
  onVenue: (id: ExchangeId) => void;
  status: VenueStatus;
  onRetry: () => void;
  /** Coins whose NATR has been computed so far / coins to compute. */
  natrProgress: { scanned: number; total: number };
  /** Height of the sticky terminal header above (it changes per tab). */
  headerHeight: number;
  /** Watchlisted base symbols (★ filter and row markers). */
  watchlist: readonly string[];
  /** Venues enabled in Settings → Exchanges & Markets. */
  venues: readonly ExchangeId[];
  /** Opens the screener filters (shared with the Market Map). */
  onFilters: () => void;
  /** Opens the color rules editor. */
  onColors: () => void;
  /** The enabled screener filter, narrowing this list (null: none enabled). */
  filter: ReviewFilter | null;
}

export interface ReviewFilter {
  name: string;
  /** Coins matching right now; null while the metric table loads or when the filter targets another venue. */
  matches: number | null;
  /** The filter targets another venue / market: it doesn't narrow this list. */
  mismatch?: { label: string; onApply: () => void };
  onClear: () => void;
}

/** The NATR column's metric (5m candles, 14 periods): its color rule applies here too. */
const NATR_RULE = 'natr_5_14';

const STATUS_COLOR: Record<string, string> = { live: COLORS.up, connecting: '#F5A524', reconnecting: '#F5A524', error: COLORS.down, idle: COLORS.muted };
const STATUS_TEXT: Record<string, string> = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', error: 'Offline', idle: 'Idle' };
const ICON_BTN = 'sx-icon-btn sx-bordered';
const venueLabel = (id: ExchangeId) => <ExchangeLabel id={id} size={14} suffix={`.${ADAPTERS[id].market === 'perp' ? 'Futures' : 'Spot'}`} />;

/** Opens Settings → Exchanges & Markets (the venues this table can show). */
function SettingsButton() {
  return (
    <button type="button" className={ICON_BTN} onClick={() => openSettings('exchanges')} title="Exchanges & markets settings" aria-label="Table settings" data-settings-link="exchanges">
      <Settings size={14} aria-hidden="true" />
    </button>
  );
}

/** Row marker: click to add / remove the coin from the watchlist. */
function WatchStar({ symbol, on }: { symbol: string; on: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggleIn(watchlistStore, symbol, !on); }}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
      data-watch={on ? 'on' : 'off'}
      style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 14, height: 14, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: on ? COLORS.alert : '#3A3D44' }}
    >
      <Star size={11} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}

export default function TickerSidebar(p: SidebarProps) {
  const { open, sortKey, sortDir } = p;
  const rules = useColorRules();
  const [starOnly, setStarOnly] = useState(false);
  const rows = starOnly ? p.rows.filter((r) => p.watchlist.includes(r.symbol)) : p.rows;
  const venueOptions = p.venues.includes(p.venue) ? p.venues : [p.venue, ...p.venues];
  const asideStyle: CSSProperties = { position: 'sticky', top: p.headerHeight, height: `calc(100vh - ${p.headerHeight}px)`, padding: '12px 12px 12px 0', display: 'flex', flexDirection: 'column' };
  const arrow = (k: SortKey): string => (sortKey === k ? (sortDir > 0 ? ' ↑' : ' ↓') : '');
  const { ref: listRef, onScroll, first, last, padTop, padBottom } = useWindow(rows.length, ROW_H);
  const visible = rows.slice(first, last);

  if (!open) {
    return (
      <aside style={{ ...asideStyle, flex: `0 0 ${RAIL_W + 12}px` }} aria-label="Tickers (collapsed)">
        <div className="sx-glass" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0' }}>
          <button type="button" className={ICON_BTN} onClick={p.onToggle} title="Show tickers" aria-label="Expand tickers">
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <SettingsButton />
        </div>
      </aside>
    );
  }

  const natrLoading = p.natrProgress.scanned < p.natrProgress.total;
  return (
    <aside style={{ ...asideStyle, flex: `0 0 ${WIDTH}px`, maxWidth: '100%' }} aria-label="Live tickers">
      <div className="sx-glass" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 10px 8px', borderBottom: `1px solid ${COLORS.line}` }}>
          <DropdownSelect label="Exchange" options={EXCHANGE_IDS.filter((id) => venueOptions.includes(id))} value={p.venue} onChange={p.onVenue} render={venueLabel} />
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" className={ICON_BTN} onClick={p.onColors} title="Color rules for metric values" aria-label="Color rules" aria-haspopup="dialog" data-color-rules>
              <Palette size={14} aria-hidden="true" />
            </button>
            <SettingsButton />
            <button type="button" className={ICON_BTN} onClick={p.onToggle} title="Hide tickers" aria-label="Collapse tickers">
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </span>
        </div>
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${COLORS.line}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 8, border: `1px solid ${COLORS.line}`, background: 'rgba(11,12,14,0.6)' }}>
            <IconSearch />
            <input
              className="sx-input"
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && rows[0]) p.onPick(rows[0].symbol); }}
              placeholder="Search / Enter the name"
              aria-label="Search symbol"
            />
          </label>
          <button
            type="button"
            className={ICON_BTN}
            onClick={() => setStarOnly((v) => !v)}
            aria-pressed={starOnly}
            aria-label="Watchlist only"
            title={starOnly ? 'Show all tickers' : `Show the watchlist only (${p.watchlist.length})`}
            style={{ height: 'auto', alignSelf: 'stretch', color: starOnly ? COLORS.alert : undefined }}
          >
            <Star size={14} fill={starOnly ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BTN}
            onClick={p.onFilters}
            aria-haspopup="dialog"
            aria-label={p.filter ? `Filters (active: ${p.filter.name})` : 'Filters'}
            title={p.filter ? `Filter “${p.filter.name}” is on` : 'Filter this list (same filters as the Market Map)'}
            data-review-filters
            style={{ height: 'auto', alignSelf: 'stretch', color: p.filter && !p.filter.mismatch ? COLORS.up : undefined, borderColor: p.filter && !p.filter.mismatch ? 'rgba(48,164,108,0.4)' : undefined }}
          >
            <FunnelPlus size={14} aria-hidden="true" />
          </button>
          </div>
          {p.filter && (
            <div
              data-review-filter={p.filter.name}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 6px 4px 8px', borderRadius: 7, border: `1px solid ${p.filter.mismatch ? COLORS.line : 'rgba(48,164,108,0.35)'}`, background: p.filter.mismatch ? 'transparent' : 'rgba(48,164,108,0.08)' }}
            >
              <FunnelPlus size={12} aria-hidden="true" style={{ flex: 'none', color: p.filter.mismatch ? COLORS.muted : COLORS.up }} />
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.filter.name}</span>
              {p.filter.mismatch ? (
                <button type="button" onClick={p.filter.mismatch.onApply} style={{ whiteSpace: 'nowrap', fontSize: 11, padding: 0, border: 0, background: 'none', color: COLORS.up, fontWeight: 600, cursor: 'pointer' }} title={`The filter targets ${p.filter.mismatch.label}`}>
                  Switch to {p.filter.mismatch.label}
                </button>
              ) : (
                <span className="sx-muted tabular-nums" style={{ whiteSpace: 'nowrap' }}>{p.filter.matches === null ? 'scanning…' : `${p.filter.matches} match`}</span>
              )}
              <button type="button" onClick={p.filter.onClear} aria-label={`Turn off filter ${p.filter.name}`} title="Turn the filter off" style={{ marginLeft: 'auto', flex: 'none', display: 'grid', placeItems: 'center', width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, background: 'none', color: COLORS.muted, cursor: 'pointer' }}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          <span className="sx-muted" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, whiteSpace: 'nowrap' }} title={p.status.error}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[p.status.state] }} />
            {STATUS_TEXT[p.status.state]} · {rows.length} of {p.total}
            {natrLoading && p.natrProgress.total > 0 && <span style={{ marginLeft: 'auto' }}>NATR {p.natrProgress.scanned} / {p.natrProgress.total}</span>}
          </span>
        </div>
        <div role="row" style={{ display: 'grid', gridTemplateColumns: TICKER_COLS, gap: 6, padding: '8px 14px', borderBottom: `1px solid ${COLORS.line}` }}>
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="sx-th"
              role="columnheader"
              aria-sort={sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}
              onClick={() => p.onSort(c.key)}
              style={{ textAlign: c.align, justifySelf: c.align === 'right' ? 'end' : 'start' }}
            >
              {c.label}{arrow(c.key)}
            </button>
          ))}
        </div>
        <div ref={listRef} onScroll={onScroll} className="sx-scroll" role="rowgroup" aria-label="Tickers" style={{ flex: 1, overflow: 'auto', padding: '4px 6px', fontSize: 12 }}>
          <div style={{ height: padTop }} aria-hidden="true" />
          {visible.map((r) => (
            <div
              key={r.symbol}
              role="row"
              className="sx-row"
              data-active={r.symbol === p.activeSymbol}
              data-symbol={r.symbol}
              onClick={() => p.onPick(r.symbol)}
              style={{ gridTemplateColumns: TICKER_COLS, height: ROW_H, paddingTop: 0, paddingBottom: 0 }}
            >
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }} title={r.symbol}>
                <WatchStar symbol={r.symbol} on={p.watchlist.includes(r.symbol)} />
                {r.symbol}
              </span>
              {/* Color rules (display units: % for change / NATR / funding, $ for volume) override the default tones. */}
              <span style={{ textAlign: 'right', color: r.ch24 === null ? COLORS.muted : ruleColor(rules, 'change24h', r.ch24 * 100) ?? tone(r.ch24) }} data-ch24>{r.ch24 === null ? '—' : fmtPct(r.ch24)}</span>
              <span style={{ textAlign: 'right', color: ruleColor(rules, NATR_RULE, r.natr) }} className={r.natr === null ? 'sx-muted' : undefined} data-natr>{r.natr === null ? '…' : `${r.natr.toFixed(2)}%`}</span>
              <span style={{ textAlign: 'right', color: r.asset.funding === null ? COLORS.muted : ruleColor(rules, 'funding', r.asset.funding * 100) ?? tone(r.asset.funding) }} data-funding>{r.asset.funding === null ? '—' : `${(r.asset.funding * 100).toFixed(4)}%`}</span>
              <span style={{ textAlign: 'right', color: ruleColor(rules, 'volume24h', r.asset.volume) }} className={ruleColor(rules, 'volume24h', r.asset.volume) ? undefined : 'sx-muted'} data-vol>{fmtUsd(r.asset.volume)}</span>
            </div>
          ))}
          <div style={{ height: padBottom }} aria-hidden="true" />
          {rows.length === 0 && p.total > 0 && (
            <div className="sx-muted" style={{ padding: '24px 8px' }}>
              {starOnly ? 'No watchlisted coins here. Add them with the ★ on a ticker or chart card.'
                : p.filter && !p.filter.mismatch && !p.query ? `No coins match “${p.filter.name}” right now.` : 'No symbols match these filters.'}
            </div>
          )}
          {p.total === 0 && (
            <div style={{ padding: '24px 8px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              {p.status.state === 'error' ? (
                <>
                  <span style={{ color: COLORS.down }}>Can’t reach {ADAPTERS[p.venue].name}.</span>
                  {p.status.error && <span className="sx-muted" style={{ fontSize: 11 }}>{p.status.error}</span>}
                  <button type="button" className="sx-btn" onClick={p.onRetry}>Retry</button>
                </>
              ) : (
                <span className="sx-muted">Connecting to {ADAPTERS[p.venue].name}…</span>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

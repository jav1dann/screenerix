'use client';

/**
 * Screenerix — Terminal workspace (paid dashboard)
 *
 * Every view reads from the live `MarketFeed` (`liveExchangeService`): exchange
 * WebSockets for every listed coin on the selected venue.
 */
import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';
import ExpandedChartModal from '@/components/chart/expanded/ExpandedChartModal';
import RatioChartModal from '@/components/chart/expanded/RatioChartModal';
import { useMarketFeed } from '@/hooks/useMarketFeed';
import { useFilters, useMetricTable } from '@/hooks/useScreener';
import IndicatorModal from '@/components/chart/IndicatorModal';
import AccountModalHost from '@/components/account/AccountModal';
import AlertsHost from '@/components/alerts/AlertsHost';
import { openAlerts } from '@/lib/alerts/alertsUi';
import { alertsClient } from '@/lib/alerts/client';
import BillingModalHost from '@/components/billing/BillingModalHost';
import SettingsModal from '@/components/settings/SettingsModal';
import StrategiesModule from '@/components/strategies/StrategiesModule';
import StrategyTabs from '@/components/strategies/StrategyTabs';
import { useSettings, useSymbolList, useTerminalPrefs } from '@/hooks/useTerminal';
import type { MarketType } from '@/lib/alerts/alertStore';

import { DEFAULT_COMPARE, HEADER_CONTROLS_H, HEADER_TOP_H, TABS } from '@/lib/market/constants';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import { toRow } from '@/lib/market/simulation';
import type { ExchangeId, SortDir, SortKey, TabId, TickerRow } from '@/lib/market/types';
import type { ChartLevel } from '@/components/chart/expanded/AdvancedChart';
import { terminalPrefs } from '@/lib/market/terminalPrefs';
import { sortRanking } from '@/lib/screener/defaultRanking';
import { METRIC_BY_KEY } from '@/lib/screener/metrics';
import {
  allowedSort, exceptionStore, marketOf, pick, settingsStore, sortDir as sortDirOf, sortLabel, sortMetric, startupPatch, venueSort, venuesFor, watchlistStore,
} from '@/lib/settings/settings';
import { EMPTY_SCAN, keysFor, rankRows } from '@/lib/screener/rank';
import { deleteFilter, saveFilter, setFilterEnabled } from '@/lib/screener/filters';
import type { ScreenerFilter } from '@/lib/screener/filters';
import ArbitrageScreener from './modules/ArbitrageScreener';
import Densities from './modules/Densities';
import type { DensityModalKind } from './modules/Densities';
import DensityControls from './DensityControls';
import MarketMap from './modules/MarketMap';
import MarketReview from './modules/MarketReview';
import ColorRulesModal from './overlays/ColorRulesModal';
import FilterManager from './overlays/FilterManager';
import TerminalHeader from './TerminalHeader';
import TickerSearchModal from './TickerSearchModal';
import type { SearchPick } from './TickerSearchModal';
import TickerSidebar from './TickerSidebar';
import type { SessionUser } from '@/lib/auth/access';
import SafeBoundary from '@/components/shared/SafeBoundary';

export interface TerminalProps {
  /** The signed-in account (profile menu, role badge). */
  user: SessionUser;
  /** Return to the public website. */
  onExit: () => void;
  /** Whether the ticker sidebar starts expanded. */
  defaultSidebarOpen?: boolean;
}

/** What the full-screen chart shows: one coin, or an A ÷ B spread from the search. */
type ExpandedView = { kind: 'single'; symbol: string; exchange: ExchangeId } | { kind: 'ratio'; a: string; b: string; exchange: ExchangeId };

const SORT_VALUE: Record<Exclude<SortKey, 'sym'>, (r: TickerRow) => number | null> = {
  ch24: (r) => r.ch24, natr: (r) => r.natr, fund: (r) => r.asset.funding, vol: (r) => r.asset.volume,
};
/** Market Review's NATR column: 5m candles, 14 periods. */
const NATR_KEY = 'natr_5_14';
const NATR_KEYS = [NATR_KEY];
/** Density levels drawn on the review chart, per book side. */
const LEVELS_PER_SIDE = 2;

export default function Terminal({ user, onExit, defaultSidebarOpen = true }: TerminalProps) {
  const [tab, setTab] = useState<TabId>('map');
  const [prefs, updateTerminalPrefs] = useTerminalPrefs();
  const settings = useSettings();
  // Session state, narrowed to what Settings offers (a disabled choice falls back to the first enabled one).
  const markets = settings.exchanges.markets;
  const marketType = pick(prefs.market, markets);
  const venues = venuesFor(settings, marketType);
  // One primary venue per market type, so switching Futures ↔ Spot restores the previous choice.
  const primary = pick(prefs.venue[marketType], venues);
  const sort = venueSort(allowedSort(prefs.sort, settings.sorting.modes), settings.sorting.modes, primary);
  const cardTf = pick(prefs.tf, settings.timeframe.enabled);
  const grid = pick(prefs.grid, settings.tops.enabled);
  const setPrimary = (market: MarketType, id: ExchangeId) => updateTerminalPrefs({ market, venue: { ...terminalPrefs.getSnapshot().venue, [market]: id } });
  // The "Default …" settings apply once, when the terminal opens.
  useEffect(() => {
    const patch = startupPatch(settingsStore.getSnapshot(), terminalPrefs.getSnapshot());
    if (patch) terminalPrefs.update(patch);
  }, []);
  const supports = (id: ExchangeId) => (ADAPTERS[id].market === 'perp' ? 'futures' : 'spot') === marketType;
  const [compare, setCompare] = useState<ExchangeId[]>([...DEFAULT_COMPARE]);
  const [activeSymbol, setActiveSymbol] = useState('BTC');
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const alertsState = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  const [searchOpen, setSearchOpen] = useState(false);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedView | null>(null);
  const [densityModal, setDensityModal] = useState<DensityModalKind>(null);
  /** Ticker-list search (Market Review sidebar). */
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('vol');
  const [sortDir, setSortDir] = useState<SortDir>(-1);

  // The primary venue is always part of the comparison set.
  const compareSet = EXCHANGE_IDS.filter((id) => supports(id) && (id === primary || compare.includes(id)));
  const feed = useMarketFeed({
    primary,
    // Extra venues only stream while the arbitrage screener is open.
    compare: tab === 'arb' ? compareSet : [],
    focus: activeSymbol,
  });

  // Ctrl/⌘+K opens the ticker search from any tab.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !expanded && !screenerOpen) {
      e.preventDefault();
      setSearchOpen(true);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const market = feed.getMarket();
  // Screener: the enabled filter drives the Market Map while it targets the shown venue;
  // otherwise the map ranks liquid coins by the header's Range window.
  const screenerFilters = useFilters();
  const activeFilter = screenerFilters.find((f) => f.enabled) ?? null;
  const filterMatches = activeFilter !== null && activeFilter.exchange === primary && activeFilter.market === marketType;
  // Exceptions (Settings → Sorting) never reach the Market Map, whatever ranks it.
  const exceptions = useSymbolList(exceptionStore);
  const watchlist = useSymbolList(watchlistStore);
  const sortId = `${sort.mode}:${sort.window}`;
  const mapRanking = useMemo(() => {
    const base = activeFilter && filterMatches
      ? activeFilter
      : sortRanking(sortId, sortLabel({ mode: sort.mode, window: sort.window }), sortMetric({ mode: sort.mode, window: sort.window }), primary, marketType, [], sortDirOf({ mode: sort.mode, window: sort.window }));
    return exceptions.length ? { ...base, ignore: [...base.ignore, ...exceptions] } : base;
  }, [activeFilter, filterMatches, sortId, sort.mode, sort.window, primary, marketType, exceptions]);
  // Card indicators that read server metrics (Settings → Indicators Above the Chart).
  const indicatorKeys = useMemo(() => settings.indicators.items.filter((k) => METRIC_BY_KEY.has(k)), [settings.indicators.items]);
  // Market Review narrows its coin list by the same enabled filter (when it targets this venue).
  const reviewFilter = tab === 'review' && activeFilter && filterMatches ? activeFilter : null;
  // The server's background scanner keeps every coin's metrics current: the Market Map ranks
  // them by the active filter (or the header sort), Market Review reads its NATR column and filter.
  // The header sort's key is always requested: the cards' "Sort metric" shows it even while a filter ranks the map.
  const sortKeyId = sortMetric(sort);
  const tableKeys = useMemo(
    () => (tab === 'review'
      ? [...new Set([...NATR_KEYS, ...(reviewFilter ? keysFor(reviewFilter) : [])])].sort()
      : [...new Set([...keysFor(mapRanking), sortKeyId, ...indicatorKeys])].sort()),
    [tab, reviewFilter, mapRanking, sortKeyId, indicatorKeys],
  );
  const table = useMetricTable(tab === 'map' || tab === 'review' ? primary : null, tableKeys);
  const freshScan = useMemo(
    () => (tab === 'map' ? rankRows(mapRanking, table.rows, primary, ADAPTERS[primary].name) : EMPTY_SCAN),
    [tab, mapRanking, table.rows, primary],
  );
  // A new filter / Range asks for other metric keys: until that table arrives (a few ms), keep showing the
  // last ranking, so the Map re-slots once — straight into the new order — instead of from an empty table.
  const [readyScan, setReadyScan] = useState(EMPTY_SCAN);
  const tableReady = table.state !== 'loading';
  if (tableReady && readyScan !== freshScan) setReadyScan(freshScan);
  const scan = tableReady ? freshScan : readyScan;
  const natrBySymbol = useMemo(() => new Map(tab === 'review' ? table.rows.map((r) => [r.s, r.m[NATR_KEY] ?? null]) : []), [tab, table.rows]);
  const metricsBySymbol = useMemo(() => new Map(tab === 'map' ? table.rows.map((r) => [r.s, r.m]) : []), [tab, table.rows]);
  const status = feed.getStatus();
  const venue = ADAPTERS[primary];
  const venueLabel = `${venue.name} · ${venue.market === 'perp' ? 'Perp' : 'Spot'}`;
  // The control row exists on the Market Map (exchange pills, filters, grid, …), Densities and Strategies.
  const headerHeight = HEADER_TOP_H + (tab === 'map' || tab === 'dens' || tab === 'strat' ? HEADER_CONTROLS_H : 0);
  // Fall back to the first listed symbol when the venue doesn't list the selected one.
  const active = market.find((a) => a.symbol === activeSymbol) ?? market[0];

  // The filter's matches, re-evaluated as stream patches arrive (null: no filter, or the table is still loading).
  const reviewMatches = useMemo(() => {
    if (!reviewFilter || table.state === 'loading') return null;
    const s = rankRows(reviewFilter, table.rows, primary, ADAPTERS[primary].name);
    return { set: new Set(s.matches.map((m) => m.symbol)), scan: s };
  }, [reviewFilter, table.rows, table.state, primary]);
  const q = query.trim().toLowerCase();
  const rows = market
    .filter((a) => !reviewMatches || reviewMatches.set.has(a.symbol))
    .map((a) => toRow(a, natrBySymbol.get(a.symbol) ?? null))
    .filter((r) => !q || r.symbol.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortKey === 'sym') return a.symbol.localeCompare(b.symbol) * sortDir;
      const x = SORT_VALUE[sortKey](a);
      const y = SORT_VALUE[sortKey](b);
      // Values not known yet sort last either way.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (x - y) * sortDir;
    });

  // The selected coin's largest order-book walls, for the review chart.
  const book = tab === 'review' && active ? feed.getBook(active.symbol) : null;
  const levels: ChartLevel[] = book ? [
    ...book.bids.filter((l) => l.wall).sort((x, y) => y.notional - x.notional).slice(0, LEVELS_PER_SIDE).map((l) => ({ price: l.price, side: 'bid' as const, notional: l.notional })),
    ...book.asks.filter((l) => l.wall).sort((x, y) => y.notional - x.notional).slice(0, LEVELS_PER_SIDE).map((l) => ({ price: l.price, side: 'ask' as const, notional: l.notional })),
  ] : [];

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(-1); }
  };
  const pickFromTable = (symbol: string) => {
    setActiveSymbol(symbol);
    if (tab === 'map' || tab === 'arb') setTab('review');
  };
  /** The sidebar's venue selector: each venue is one market (Futures or Spot). */
  const pickVenue = (id: ExchangeId) => setPrimary(marketOf(id), id);
  /** Header pills choose the primary venue. */
  const pickPrimary = (id: ExchangeId) => {
    if (supports(id)) setPrimary(marketType, id);
  };
  /** Arbitrage pills toggle extra venues to compare (the primary always stays). */
  const toggleCompare = (id: ExchangeId) => {
    if (!supports(id) || id === primary) return;
    setCompare((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const openFromSearch = ({ symbol, exchange }: SearchPick) => {
    setSearchOpen(false);
    if (exchange === primary) setActiveSymbol(symbol);
    setExpanded({ kind: 'single', symbol, exchange });
  };
  /** Point the terminal at a filter's venue and market. */
  const showFilterVenue = (f: ScreenerFilter) => setPrimary(f.market, f.exchange);
  const toggleScreener = (f: ScreenerFilter, enabled: boolean) => {
    setFilterEnabled(f.id, enabled);
    if (enabled) showFilterVenue(f);
  };
  const saveScreener = (f: ScreenerFilter) => {
    saveFilter(f);
    if (f.enabled) showFilterVenue(f);
  };


  // The primary venue's market list failed: say so (it keeps retrying by itself, with backoff) and offer Retry.
  const feedDown = status[primary].state === 'error'
    ? { text: `${venue.name} is unavailable — ${status[primary].error ?? 'connection failed'}. Retrying automatically…`, onRetry: () => feed.retry(primary) }
    : null;
  const waiting = (
    <div className="sx-glass sx-skeleton" style={{ height: 240 }}>
      {feedDown ? (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} role="alert" data-feed-error>
          {feedDown.text}
          <button type="button" className="sx-btn" onClick={feedDown.onRetry} data-feed-retry>Retry now</button>
        </span>
      ) : `Waiting for ${venueLabel} data…`}
    </div>
  );

  return (
    <div className="sx-root">
      <TerminalHeader
        user={user}
        tab={tab}
        onTab={setTab}
        primary={primary}
        status={status}
        onPickExchange={pickPrimary}
        market={marketType}
        onMarket={(m) => updateTerminalPrefs({ market: m })}
        sort={sort}
        onSort={(next) => updateTerminalPrefs({ sort: next })}
        tf={cardTf}
        onTf={(next) => updateTerminalPrefs({ tf: next })}
        grid={grid}
        onGrid={(g) => updateTerminalPrefs({ grid: g })}
        options={{ venues: settings.exchanges.venues, markets, sortModes: settings.sorting.modes, timeframes: settings.timeframe.enabled, grids: settings.tops.enabled }}
        onSearch={() => setSearchOpen(true)}
        onScreener={() => setScreenerOpen(true)}
        activeScreener={activeFilter?.name ?? null}
        unread={alertsState.unread}
        onOpenAlerts={openAlerts}
        onExit={onExit}
        densityControls={<DensityControls onFilters={() => setDensityModal('filters')} onColoring={() => setDensityModal('coloring')} />}
        strategyControls={tab === 'strat' ? <StrategyTabs /> : null}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <main style={{ flex: '1 1 auto', minWidth: 0, padding: 12 }}>
          {/* A failing module shows its error with "Try again" instead of taking the terminal down (switching tabs clears it). */}
          <SafeBoundary key={tab} name={TABS.find((t) => t.id === tab)?.label ?? 'This view'}>
          {tab === 'map' && (
            <MarketMap
              key={primary}
              market={market}
              exchange={primary}
              sort={sort}
              metrics={metricsBySymbol}
              tf={cardTf}
              grid={grid}
              unavailable={feedDown}
              scan={scan}
              dir={mapRanking.sort.dir}
              screen={activeFilter && {
                name: activeFilter.name,
                scan,
                onClear: () => setFilterEnabled(activeFilter.id, false),
                mismatch: filterMatches ? undefined : {
                  label: `${ADAPTERS[activeFilter.exchange].name} ${activeFilter.market === 'futures' ? 'Futures' : 'Spot'}`,
                  onApply: () => showFilterVenue(activeFilter),
                },
              }}
            />
          )}
          {tab === 'review' && (active
            ? <MarketReview symbol={active.symbol} exchange={primary} marketType={marketType} levels={levels} headerHeight={headerHeight} funding={active.funding} />
            : waiting)}
          {tab === 'dens' && (
            <Densities
              primary={primary}
              getLevels={feed.getLevels}
              modal={densityModal}
              onModal={setDensityModal}
              onOpenChart={(symbol, exchange) => setExpanded({ kind: 'single', symbol, exchange })}
            />
          )}
          {tab === 'strat' && <StrategiesModule primary={primary} />}
          {tab === 'arb' && (
            <ArbitrageScreener
              market={market}
              venues={compareSet}
              primary={primary}
              marketType={marketType}
              status={status}
              onToggleVenue={toggleCompare}
              getQuote={feed.getQuote}
            />
          )}
          </SafeBoundary>
        </main>
        {/* The ticker table is a Market Review tool (right side); other views use the full width. */}
        {tab === 'review' && <SafeBoundary name="Ticker list"><TickerSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          rows={rows}
          total={market.length}
          activeSymbol={active?.symbol ?? activeSymbol}
          onPick={pickFromTable}
          query={query}
          onQuery={setQuery}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          venue={primary}
          onVenue={pickVenue}
          status={status[primary]}
          onRetry={() => feed.retry(primary)}
          natrProgress={{ scanned: table.coverage.scanned, total: table.coverage.total }}
          watchlist={watchlist}
          venues={settings.exchanges.venues}
          headerHeight={headerHeight}
          onFilters={() => setScreenerOpen(true)}
          onColors={() => setColorsOpen(true)}
          filter={activeFilter && {
            name: activeFilter.name,
            matches: reviewMatches ? reviewMatches.set.size : null,
            onClear: () => setFilterEnabled(activeFilter.id, false),
            mismatch: filterMatches ? undefined : {
              label: `${ADAPTERS[activeFilter.exchange].name} ${activeFilter.market === 'futures' ? 'Futures' : 'Spot'}`,
              onApply: () => showFilterVenue(activeFilter),
            },
          }}
        /></SafeBoundary>}
      </div>

      {searchOpen && (
        <TickerSearchModal
          market={market}
          primary={primary}
          marketType={marketType}
          onPick={openFromSearch}
          onPickSpread={({ a, b, exchange }) => { setSearchOpen(false); setExpanded({ kind: 'ratio', a, b, exchange }); }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {screenerOpen && (
        <FilterManager
          filters={screenerFilters}
          market={market}
          primary={primary}
          marketType={marketType}
          onSave={saveScreener}
          onToggle={toggleScreener}
          onDelete={deleteFilter}
          onClose={() => setScreenerOpen(false)}
          onColors={() => { setScreenerOpen(false); setColorsOpen(true); }}
        />
      )}
      {colorsOpen && <ColorRulesModal onClose={() => setColorsOpen(false)} />}
      <SettingsModal />
      <BillingModalHost />
      <AlertsHost />
      <AccountModalHost />
      <IndicatorModal />
      {expanded?.kind === 'ratio' && (
        <RatioChartModal a={expanded.a} b={expanded.b} exchange={expanded.exchange} initialInterval={cardTf} onClose={() => setExpanded(null)} />
      )}
      {expanded?.kind === 'single' && (
        <ExpandedChartModal
          key={`${expanded.exchange}:${expanded.symbol}`}
          symbol={expanded.symbol}
          exchange={expanded.exchange}
          marketType={ADAPTERS[expanded.exchange].market === 'perp' ? 'futures' : 'spot'}
          initialInterval={cardTf}
         
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import { IconArrowLeft, IconBell } from '@/components/shared/icons';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import { HEADER_CONTROLS_H, TABS } from '@/lib/market/constants';
import type { ExchangeId, StatusMap, TabId } from '@/lib/market/types';
import { COLORS } from '@/lib/theme';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { Timeframe } from '@/lib/market/exchanges';
import type { GridCount } from '@/lib/market/terminalPrefs';
import type { SortMode, SortPref } from '@/lib/settings/settings';
import { GridSelect, MarketMapActions, MarketTypeToggle, SortSelect, TimeframeGroup } from './MarketControls';
import ProfileMenu from './ProfileMenu';
import type { SessionUser } from '@/lib/auth/access';
import VenuePills from './VenuePills';

interface TerminalHeaderProps {
  tab: TabId;
  onTab: (t: TabId) => void;
  primary: ExchangeId;
  status: StatusMap;
  onPickExchange: (id: ExchangeId) => void;
  market: MarketType;
  onMarket: (m: MarketType) => void;
  /** Market Map sort. */
  sort: SortPref;
  onSort: (s: SortPref) => void;
  /** Market Map card timeframe. */
  tf: Timeframe;
  onTf: (tf: Timeframe) => void;
  /** Market Map grid layout (card count). */
  grid: GridCount;
  onGrid: (g: GridCount) => void;
  /** What Settings offers in the header: venues of the current market, markets, sort modes, timeframes, grids. */
  options: { venues: readonly ExchangeId[]; markets: readonly MarketType[]; sortModes: readonly SortMode[]; timeframes: readonly Timeframe[]; grids: readonly GridCount[] };
  /** Opens the ticker search. */
  onSearch: () => void;
  /** Opens the screener filter manager. */
  onScreener: () => void;
  /** Name of the enabled screener filter, if any. */
  activeScreener: string | null;
  unread: number;
  onOpenAlerts: () => void;
  onExit: () => void;
  user: SessionUser;
  /** Control row of the Densities tab. */
  densityControls?: ReactNode;
  /** Control row of the Strategies tab (workspace tabs). */
  strategyControls?: ReactNode;
}

export default function TerminalHeader({
  tab, onTab, primary, status, onPickExchange, market, onMarket, sort, onSort, tf, onTf, grid, onGrid, options, onSearch, onScreener, activeScreener,
  unread, onOpenAlerts, onExit, user, densityControls, strategyControls,
}: TerminalHeaderProps) {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(11,12,14,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: `1px solid ${COLORS.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 56, padding: '0 16px', minWidth: 0 }}>
        <button onClick={onExit} title="Back to website" aria-label="Back to website" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', flex: 'none' }}>
          <ScreenerixLogo />
        </button>
        <nav className="sx-seg sx-noscroll" style={{ flex: '0 1 auto', minWidth: 0, overflowX: 'auto' }} aria-label="Modules">
          {TABS.map((t) => (
            <button key={t.id} className="sx-seg-opt" data-active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)} style={{ fontSize: 13 }}>{t.label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', flex: 'none', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="sx-btn sx-btn-ghost" onClick={onExit}><IconArrowLeft />Exit to website</button>
          <button className="sx-btn" onClick={onOpenAlerts}>
            <IconBell />Alerts
            {unread > 0 && <span className="sx-tag" style={{ fontSize: 10, padding: '1px 6px', background: COLORS.down, color: '#fff' }}>{unread}</span>}
          </button>
          <ProfileMenu user={user} />
        </div>
      </div>
      {/* Market Map controls — this row only exists on the Market Map tab. */}
      {tab === 'map' && (
        <div className="sx-noscroll sx-fade-x" style={{ display: 'flex', alignItems: 'center', gap: 6, height: HEADER_CONTROLS_H, padding: '0 16px', borderTop: `1px solid ${COLORS.line}`, overflowX: 'auto' }}>
          <VenuePills
            label="Exchange"
            hint="Choose the venue that drives the terminal"
            market={market}
            status={status}
            isSelected={(id) => id === primary}
            onPick={onPickExchange}
            venues={options.venues}
          />
          <span className="mx-1 h-5 w-px shrink-0 bg-sx-line" aria-hidden="true" />
          <MarketTypeToggle value={market} onChange={onMarket} markets={options.markets} />
          <SortSelect value={sort} onChange={onSort} modes={options.sortModes} venue={primary} />
          <span className="mx-1 h-5 w-px shrink-0 bg-sx-line" aria-hidden="true" />
          <TimeframeGroup value={tf} onChange={onTf} options={options.timeframes} />
          <span className="mx-1 h-5 w-px shrink-0 bg-sx-line" aria-hidden="true" />
          <GridSelect value={grid} onChange={onGrid} options={options.grids} />
          <MarketMapActions onSearch={onSearch} onFilters={onScreener} activeFilter={activeScreener} />
        </div>
      )}
      {/* Densities controls (exchanges, markets, filters, coloring, sorting). */}
      {tab === 'dens' && densityControls && (
        <div className="sx-noscroll sx-fade-x" style={{ display: 'flex', alignItems: 'center', gap: 6, height: HEADER_CONTROLS_H, padding: '0 16px', borderTop: `1px solid ${COLORS.line}`, overflowX: 'auto' }}>
          {densityControls}
        </div>
      )}
      {/* Strategies: Dashboard + workspace tabs. */}
      {tab === 'strat' && strategyControls && (
        <div className="sx-noscroll sx-fade-x" style={{ display: 'flex', alignItems: 'center', gap: 6, height: HEADER_CONTROLS_H, padding: '0 16px', borderTop: `1px solid ${COLORS.line}`, overflowX: 'auto' }}>
          {strategyControls}
        </div>
      )}
    </header>
  );
}

'use client';

/** Header control row of the Strategies tab: Dashboard + one tab per enabled strategy workspace. */
import { useMemo } from 'react';
import { LayoutDashboard, Plus, Settings as SettingsIcon } from 'lucide-react';
import { BTN_RESET } from '@/components/chart/styles';
import { CONTROL, SEG, SEG_ACTIVE, SEG_IDLE, SEG_OPT } from '@/components/terminal/MarketControls';
import { useNow } from '@/hooks/useDensities';
import { useStrategies } from '@/hooks/useStrategies';
import { useSymbolList } from '@/hooks/useTerminal';
import { ADAPTERS } from '@/lib/market/exchanges';
import { exceptionStore } from '@/lib/settings/settings';
import { STRATEGY_BY_ID } from '@/lib/strategies/catalog';
import { workspaceFormations } from '@/lib/strategies/filter';
import { openPool, openWorkspaceSettings, selectStrategyTab } from '@/lib/strategies/ui';
import { useStrategyUi, useWorkspaceFeed } from './StrategiesModule';

const ACTION = `${BTN_RESET} ${CONTROL} inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-sx-line px-2.5 text-xs font-semibold text-sx-muted transition-colors hover:bg-white/[0.07] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`;

export default function StrategyTabs() {
  const { workspaces } = useStrategies();
  const ui = useStrategyUi();
  const feed = useWorkspaceFeed();
  const now = useNow(5_000);
  const exceptionList = useSymbolList(exceptionStore);
  const exceptions = useMemo(() => new Set(exceptionList), [exceptionList]);
  const enabled = workspaces.filter((w) => w.enabled);
  const current = enabled.some((w) => w.uid === ui.tab) ? ui.tab : 'dashboard';

  return (
    <>
      <nav role="tablist" aria-label="Strategy workspaces" className={SEG}>
        <button type="button" role="tab" aria-selected={current === 'dashboard'} onClick={() => selectStrategyTab('dashboard')} className={`${SEG_OPT} inline-flex items-center gap-1.5 px-2.5 ${current === 'dashboard' ? SEG_ACTIVE : SEG_IDLE}`} data-strategy-tab="dashboard">
          <LayoutDashboard size={12} aria-hidden="true" />Dashboard
        </button>
        {enabled.map((w) => {
          const n = workspaceFormations(w, feed.formations, now, exceptions).length;
          return (
            <button
              key={w.uid}
              type="button"
              role="tab"
              aria-selected={current === w.uid}
              onClick={() => selectStrategyTab(w.uid)}
              title={`${STRATEGY_BY_ID.get(w.strategy)!.summary} · ${ADAPTERS[w.venue].name}`}
              className={`${SEG_OPT} inline-flex items-center gap-1.5 px-2.5 ${current === w.uid ? SEG_ACTIVE : SEG_IDLE}`}
              data-strategy-tab={w.uid}
            >
              {w.name}
              <span className={`rounded px-1 text-[10px] tabular-nums ${n ? 'bg-sx-up/15 text-sx-up' : 'bg-white/[0.06] text-sx-muted'}`} data-tab-count={n}>{n}</span>
            </button>
          );
        })}
      </nav>
      {current !== 'dashboard' && (
        <button type="button" className={ACTION} onClick={() => openWorkspaceSettings(current)} aria-label="Workspace settings"><SettingsIcon size={13} aria-hidden="true" />Settings</button>
      )}
      <button type="button" className={ACTION} onClick={openPool} aria-label="Add Strategy" title="Strategy Pool"><Plus size={13} aria-hidden="true" />Add Strategy</button>
    </>
  );
}

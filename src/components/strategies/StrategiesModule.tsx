'use client';

/**
 * Strategies: the Dashboard (My Strategies + Formations Feed) and one workspace
 * tab per subscribed strategy (a grid of live charts with the formation's
 * levels). Formations come from the server's strategy engine; every filter is
 * local, so settings apply instantly.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import ExpandedChartModal from '@/components/chart/expanded/ExpandedChartModal';
import { useNow } from '@/hooks/useDensities';
import { useStrategies, useStrategyFeed } from '@/hooks/useStrategies';
import { useSymbolList } from '@/hooks/useTerminal';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { exceptionStore } from '@/lib/settings/settings';
import { strategyUi } from '@/lib/strategies/ui';
import type { Formation } from '@/lib/strategies/types';
import type { Workspace } from '@/lib/strategies/store';
import Dashboard from './Dashboard';
import { chartTfFor, tradeLevelsOf } from './parts';
import StrategyPoolModal from './StrategyPoolModal';
import WorkspaceSettingsModal from './WorkspaceSettingsModal';
import WorkspaceView from './WorkspaceView';

export interface StrategiesModuleProps {
  /** New workspaces start on the terminal's venue. */
  primary: ExchangeId;
}

export function useStrategyUi() {
  return useSyncExternalStore(strategyUi.subscribe, strategyUi.getSnapshot, strategyUi.getServerSnapshot);
}

/** Every workspace's venue (formations of disabled workspaces still feed their counters). */
export function useWorkspaceFeed() {
  const { workspaces } = useStrategies();
  const venues = useMemo(() => [...new Set(workspaces.map((w) => w.venue))], [workspaces]);
  return useStrategyFeed(venues);
}

export default function StrategiesModule({ primary }: StrategiesModuleProps) {
  const state = useStrategies();
  const ui = useStrategyUi();
  const feed = useWorkspaceFeed();
  const now = useNow(5_000);
  const exceptionList = useSymbolList(exceptionStore);
  const exceptions = useMemo(() => new Set(exceptionList), [exceptionList]);
  const [open, setOpen] = useState<{ f: Formation; ws?: Workspace } | null>(null);

  const ws = state.workspaces.find((w) => w.uid === ui.tab && w.enabled) ?? null;
  const settingsWs = ui.settings ? state.workspaces.find((w) => w.uid === ui.settings!.uid) ?? null : null;
  const openLevels = useMemo(() => (open ? tradeLevelsOf(open.f, open.ws?.settings) : null), [open]);

  return (
    <div className="flex flex-col gap-4 text-sx-text" data-strategies>
      {ws
        ? <WorkspaceView key={ws.uid} ws={ws} feed={feed} now={now} exceptions={exceptions} focus={ui.focus} onOpen={(f) => setOpen({ f, ws })} />
        : <Dashboard state={state} feed={feed} now={now} exceptions={exceptions} onOpen={(f, w) => setOpen({ f, ws: w })} />}

      {ui.pool && <StrategyPoolModal workspaces={state.workspaces} primary={primary} />}
      {settingsWs && ui.settings && <WorkspaceSettingsModal ws={settingsWs} tab={ui.settings.tab} feed={feed} now={now} exceptions={exceptions} />}
      {open && (
        <ExpandedChartModal
          key={open.f.id}
          symbol={open.f.symbol}
          exchange={open.f.venue}
          marketType={ADAPTERS[open.f.venue].market === 'perp' ? 'futures' : 'spot'}
          initialInterval={chartTfFor(open.f, open.ws?.settings)}
          tradeLevels={openLevels}
         
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

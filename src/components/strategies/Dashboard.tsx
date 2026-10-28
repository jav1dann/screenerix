'use client';

/** Strategies → Dashboard: My Strategies (cards / table) and the Formations Feed (cards / table). */
import { Plus, Settings as SettingsIcon } from 'lucide-react';
import { BTN_RESET, ICON_BTN } from '@/components/chart/styles';
import { SEG, SEG_ACTIVE, SEG_IDLE, SEG_OPT } from '@/components/terminal/MarketControls';
import { Select } from '@/components/shared/form';
import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { StrategyFeed } from '@/lib/scan/client';
import { STAGE_META, STRATEGY_BY_ID, tfLabel } from '@/lib/strategies/catalog';
import { feedFormations, stageCounts, workspaceFormations } from '@/lib/strategies/filter';
import { FEED_SORTS, setDashboard, toggleWorkspace } from '@/lib/strategies/store';
import type { StrategiesState, TableField, Workspace } from '@/lib/strategies/store';
import { STAGES } from '@/lib/strategies/types';
import type { Formation, Quality, Stage } from '@/lib/strategies/types';
import { openPool, openWorkspaceSettings, selectStrategyTab } from '@/lib/strategies/ui';
import { ANY_COIN } from '@/lib/alerts/types';
import { CARDS_TABLE, FormationCard, FormationTable, ViewSwitch } from './parts';
import StrategyAlertButton from './StrategyAlertButton';

/** A strategy's one-click alert: its setups on any coin, any timeframe and side. */
const anyCoin = (ws: Workspace) => ({ exchange: ws.venue, symbol: ANY_COIN, strategy: ws.strategy, tf: 'any' as const, dir: 'any' as const });

const MAX_FEED_CARDS = 120;
const MAX_FEED_ROWS = 300;
const FEED_FIELDS: readonly TableField[] = ['symbol', 'venue', 'strategy', 'tf', 'stage', 'dir', 'quality', 'strength', 'potential', 'price', 'entry', 'sl', 'tp1', 'tp2', 'distance', 'volume', 'age', 'flags'];
const QUALITY_OPTIONS: ReadonlyArray<{ value: Quality; label: string }> = [{ value: 'LOW', label: 'Quality ≥ LOW' }, { value: 'MID', label: 'Quality ≥ MID' }, { value: 'HIGH', label: 'Quality ≥ HIGH' }];
const POTENTIAL_OPTIONS = [0, 1, 2, 3, 5].map((v) => ({ value: v, label: v ? `Potential ≥ ${v}%` : 'Any potential' }));

interface DashboardProps {
  state: StrategiesState;
  feed: StrategyFeed;
  now: number;
  exceptions: ReadonlySet<string>;
  onOpen: (f: Formation, ws: Workspace) => void;
}

export default function Dashboard({ state, feed, now, exceptions, onOpen }: DashboardProps) {
  const { workspaces, dashboard: d } = state;
  const items = feedFormations(workspaces, feed.formations, d, now, exceptions);
  const loading = feed.state === 'loading' || feed.coverage.some((c) => c.total === 0 || c.scanned < c.total * 0.5);

  return (
    <>
      {/* ── My Strategies ── */}
      <section className="flex flex-col gap-2.5" aria-labelledby="my-strategies" data-section="strategies">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="my-strategies" className="m-0 text-sm font-semibold">My Strategies</h2>
          <span className="text-xs text-sx-muted">{workspaces.length ? `${workspaces.filter((w) => w.enabled).length} of ${workspaces.length} on` : 'None yet'}</span>
          <span className="ml-auto" />
          <ViewSwitch label="My Strategies view" value={d.strategiesView} onChange={(v) => setDashboard({ strategiesView: v })} options={CARDS_TABLE} />
        </div>
        {d.strategiesView === 'cards' ? (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }} data-strategy-cards>
            {workspaces.map((ws) => <StrategyCard key={ws.uid} ws={ws} counts={stageCounts(ws, feed.formations, now, exceptions)} matching={workspaceFormations(ws, feed.formations, now, exceptions).length} />)}
            <button
              type="button"
              onClick={openPool}
              className={`${BTN_RESET} flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-sx-line2 text-sm font-semibold text-sx-muted transition-colors hover:border-sx-up/60 hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`}
              data-add-strategy
            >
              <Plus size={18} aria-hidden="true" />Add Strategy
              <span className="text-[11px] font-normal">Browse the Strategy Pool</span>
            </button>
          </div>
        ) : (
          <StrategyTable workspaces={workspaces} feed={feed} now={now} exceptions={exceptions} />
        )}
      </section>

      {/* ── Formations Feed ── */}
      <section className="flex flex-col gap-2.5" aria-labelledby="formations-feed" data-section="feed">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="formations-feed" className="m-0 text-sm font-semibold">Formations Feed</h2>
          <span className="text-xs tabular-nums text-sx-muted" data-feed-count={items.length}>{items.length} formation{items.length === 1 ? '' : 's'}</span>
          {feed.coverage.map((c) => (
            <span key={c.venue} className="text-xs tabular-nums text-sx-muted">· {ADAPTERS[c.venue].name} {c.total ? `${c.scanned} / ${c.total} coins` : 'starting…'}</span>
          ))}
          <span className="ml-auto" />
          <ViewSwitch label="Formations Feed view" value={d.feedView} onChange={(v) => setDashboard({ feedView: v })} options={CARDS_TABLE} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Stage filter" className={`${SEG} sx-noscroll max-w-full overflow-x-auto`}>
            {(['ALL', ...STAGES] as const).map((s) => (
              <button key={s} type="button" aria-pressed={d.stage === s} onClick={() => setDashboard({ stage: s })} className={`${SEG_OPT} inline-flex items-center gap-1 px-2.5 ${d.stage === s ? SEG_ACTIVE : SEG_IDLE}`} title={s === 'ALL' ? 'Every stage' : STAGE_META[s].hint} data-stage-filter={s}>
                {s !== 'ALL' && <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_META[s].color }} aria-hidden="true" />}
                {s === 'ALL' ? 'All' : s}
              </button>
            ))}
          </div>
          <div className="w-36"><Select label="Quality" value={d.quality} onChange={(quality) => setDashboard({ quality })} options={QUALITY_OPTIONS} /></div>
          <div className="w-40"><Select label="Potential" value={d.minPotential} onChange={(minPotential) => setDashboard({ minPotential })} options={POTENTIAL_OPTIONS} /></div>
          <div className="w-44"><Select label="Sort" value={d.sort} onChange={(sort) => setDashboard({ sort })} options={FEED_SORTS} /></div>
        </div>

        {!workspaces.length ? (
          <Empty>Add a strategy to start tracking formations across the market.</Empty>
        ) : !items.length ? (
          <Empty>{loading ? 'Scanning the market for formations…' : workspaces.some((w) => w.enabled) ? 'No formations match the feed filters right now.' : 'Every strategy is off — switch one on above.'}</Empty>
        ) : d.feedView === 'cards' ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))' }} data-feed-cards>
            {items.slice(0, MAX_FEED_CARDS).map(({ f, ws }) => (
              <FormationCard
                key={f.id}
                f={f}
                now={now}
                onOpen={() => onOpen(f, ws)}
                action={(
                  <button type="button" className={`${BTN_RESET} rounded px-1 text-[10px] font-semibold text-sx-muted underline-offset-2 hover:text-sx-text hover:underline`} onClick={(e) => { e.stopPropagation(); selectStrategyTab(ws.uid, f.id); }} title={`Show in the ${ws.name} workspace`}>
                    {ws.name} →
                  </button>
                )}
              />
            ))}
          </div>
        ) : (
          <FormationTable label="Formations Feed" rows={items.slice(0, MAX_FEED_ROWS).map((x) => x.f)} fields={FEED_FIELDS} now={now} onOpen={(f) => { const it = items.find((x) => x.f.id === f.id); if (it) onOpen(f, it.ws); }} />
        )}
        {items.length > (d.feedView === 'cards' ? MAX_FEED_CARDS : MAX_FEED_ROWS) && <p className="m-0 text-center text-xs text-sx-muted">Showing the first {d.feedView === 'cards' ? MAX_FEED_CARDS : MAX_FEED_ROWS} — narrow the filters to see the rest.</p>}
      </section>
    </>
  );
}

function Empty({ children }: { children: string }) {
  return <div className="sx-glass sx-skeleton" style={{ height: 140 }} data-empty>{children}</div>;
}

function Switch({ ws }: { ws: Workspace }) {
  return (
    <button type="button" role="switch" aria-checked={ws.enabled} aria-label={`${ws.name} on`} title={ws.enabled ? 'Turn off' : 'Turn on'} onClick={(e) => { e.stopPropagation(); toggleWorkspace(ws.uid, !ws.enabled); }} className={`${BTN_RESET} flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${ws.enabled ? 'justify-end bg-sx-up' : 'justify-start bg-sx-line2'}`}>
      <span className="h-3 w-3 rounded-full bg-white" aria-hidden="true" />
    </button>
  );
}

function StrategyCard({ ws, counts, matching }: { ws: Workspace; counts: Record<Stage, number>; matching: number }) {
  const def = STRATEGY_BY_ID.get(ws.strategy)!;
  const open = () => { if (ws.enabled) selectStrategyTab(ws.uid); };
  return (
    <article
      className={`sx-glass flex flex-col gap-2.5 p-3 transition-colors ${ws.enabled ? 'cursor-pointer hover:border-sx-line2' : 'opacity-60'}`}
      data-strategy-card={ws.uid}
      onClick={open}
      aria-label={`${ws.name} strategy`}
    >
      <header className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-bold" title={def.description}>{ws.name}</span>
          <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-sx-muted"><ExchangeIcon id={ws.venue} size={11} />{ADAPTERS[ws.venue].name} · {tfLabel(def)} · {matching} matching</span>
        </span>
        <Switch ws={ws} />
        <StrategyAlertButton target={anyCoin(ws)} />
        <button type="button" className={ICON_BTN} onClick={(e) => { e.stopPropagation(); openWorkspaceSettings(ws.uid); }} aria-label={`${ws.name} settings`} title="Settings">
          <SettingsIcon size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="grid grid-cols-4 gap-1.5">
        {STAGES.map((s) => (
          <span key={s} className="flex flex-col items-center gap-0.5 rounded-lg py-1.5" style={{ background: `${STAGE_META[s].color}14` }} title={`${STAGE_META[s].label}: ${STAGE_META[s].hint}`}>
            <span className="text-base font-bold tabular-nums" style={{ color: STAGE_META[s].color }} data-count={s}>{counts[s]}</span>
            <span className="text-[8.5px] font-bold tracking-wide text-sx-muted">{s}</span>
          </span>
        ))}
      </div>
    </article>
  );
}

function StrategyTable({ workspaces, feed, now, exceptions }: { workspaces: readonly Workspace[]; feed: StrategyFeed; now: number; exceptions: ReadonlySet<string> }) {
  return (
    <div className="sx-glass sx-scroll overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" aria-label="My Strategies" data-strategy-table>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-sx-muted">
            {['On', 'Strategy', 'Exchange', 'Timeframe', ...STAGES, 'Matching', ''].map((h, i) => <th key={i} scope="col" className="whitespace-nowrap border-0 border-b border-solid border-sx-line px-3 py-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {workspaces.map((ws) => {
            const counts = stageCounts(ws, feed.formations, now, exceptions);
            const def = STRATEGY_BY_ID.get(ws.strategy)!;
            return (
              <tr key={ws.uid} data-strategy-row={ws.uid} className={`tabular-nums text-sx-muted ${ws.enabled ? '' : 'opacity-60'}`}>
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5"><Switch ws={ws} /></td>
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5">
                  <button type="button" disabled={!ws.enabled} className={`${BTN_RESET} font-bold text-sx-text hover:underline disabled:no-underline`} onClick={() => selectStrategyTab(ws.uid)}>{ws.name}</button>
                </td>
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5"><ExchangeLabel id={ws.venue} size={13} /></td>
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5">{tfLabel(def)}</td>
                {STAGES.map((s) => <td key={s} className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5 font-bold" style={{ color: STAGE_META[s].color }} data-count={s}>{counts[s]}</td>)}
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5 text-sx-text">{workspaceFormations(ws, feed.formations, now, exceptions).length}</td>
                <td className="border-0 border-b border-solid border-sx-line/60 px-3 py-1.5">
                  <span className="flex items-center gap-1">
                    <StrategyAlertButton target={anyCoin(ws)} />
                    <button type="button" className={ICON_BTN} onClick={() => openWorkspaceSettings(ws.uid)} aria-label={`${ws.name} settings`} title="Settings"><SettingsIcon size={14} aria-hidden="true" /></button>
                  </span>
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={STAGES.length + 6} className="px-3 py-2">
              <button type="button" onClick={openPool} className={`${BTN_RESET} inline-flex items-center gap-1 text-[12px] font-semibold text-sx-muted hover:text-sx-text`} data-add-strategy><Plus size={13} aria-hidden="true" />Add Strategy</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

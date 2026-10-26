'use client';

/**
 * Workspace Settings: General, Strategy, Filter & Sorting, Table Fields, Levels.
 * Changes apply live to the workspace (tab, grid, counters, feed); each tab has
 * "Reset default".
 */
import { useState } from 'react';
import { RotateCcw, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { BTN_RESET, GHOST_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { SEG, SEG_ACTIVE, SEG_IDLE, SEG_OPT } from '@/components/terminal/MarketControls';
import ReorderList from '@/components/settings/ReorderList';
import { CheckRow, Field, Group, NumberInput, Select, Toggle } from '@/components/shared/form';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { StrategyFeed } from '@/lib/scan/client';
import { isMultiTf, STAGE_META, STRATEGY_BY_ID, tfLabel } from '@/lib/strategies/catalog';
import { LEVEL_COLORS } from '@/lib/strategies/chartLines';
import { workspaceFormations } from '@/lib/strategies/filter';
import { CHART_TF_OPTIONS, COLUMN_OPTIONS, FEED_SORTS, MAX_CHARTS, removeWorkspace, resetWorkspaceSection, TABLE_FIELDS, updateWorkspace } from '@/lib/strategies/store';
import type { SettingsSection, TableField, Workspace, WorkspaceSettings } from '@/lib/strategies/store';
import { qualityOf, STAGES } from '@/lib/strategies/types';
import { closeWorkspaceSettings, selectStrategyTab, selectWorkspaceSettingsTab, WORKSPACE_SETTINGS_TABS } from '@/lib/strategies/ui';
import type { WorkspaceSettingsTab } from '@/lib/strategies/ui';
import Modal from './Modal';
import { QUALITY_COLOR } from './parts';

const SECTION: Record<WorkspaceSettingsTab, SettingsSection> = { general: 'general', strategy: 'strategy', filter: 'filter', fields: 'fields', levels: 'levels' };
const VOLUME_OPTIONS = [0, 1e6, 5e6, 10e6, 50e6, 100e6].map((v) => ({ value: v, label: v ? `≥ $${v / 1e6}M` : 'Any volume' }));

interface Props { ws: Workspace; tab: WorkspaceSettingsTab; feed: StrategyFeed; now: number; exceptions: ReadonlySet<string> }
type Set = (patch: Partial<WorkspaceSettings>) => void;

export default function WorkspaceSettingsModal({ ws, tab, feed, now, exceptions }: Props) {
  const set: Set = (patch) => updateWorkspace(ws.uid, { settings: patch });
  const matching = workspaceFormations(ws, feed.formations, now, exceptions).length;
  const label = WORKSPACE_SETTINGS_TABS.find((t) => t.id === tab)!.label;
  return (
    <Modal
      title={`${ws.name} — Settings`}
      icon={<SettingsIcon size={16} className="text-sx-muted" aria-hidden="true" />}
      onClose={closeWorkspaceSettings}
      maxWidth={820}
      height="min(640px, calc(100vh - 24px))"
      data="workspace-settings"
      footer={(
        <>
          <button type="button" className={GHOST_BTN} onClick={() => resetWorkspaceSection(ws.uid, SECTION[tab])}><RotateCcw size={13} className="mr-1.5" aria-hidden="true" />Reset default</button>
          <span className="text-[11px] tabular-nums text-sx-muted" data-settings-matching={matching}>{matching} formation{matching === 1 ? '' : 's'} match</span>
          <button type="button" className={`${PRIMARY_BTN} ml-auto`} onClick={closeWorkspaceSettings}>Done</button>
        </>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div role="tablist" aria-orientation="vertical" aria-label="Workspace settings sections" className="sx-noscroll flex shrink-0 gap-1 overflow-x-auto border-0 border-b border-solid border-sx-line p-2 md:w-48 md:flex-col md:border-b-0 md:border-r md:p-3">
          {WORKSPACE_SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-tab={t.id}
              onClick={() => selectWorkspaceSettingsTab(t.id)}
              className={`${BTN_RESET} shrink-0 rounded-lg px-3 py-2 text-left text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-sx-up ${tab === t.id ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:bg-white/[0.04] hover:text-sx-text'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={label} data-panel={tab} className="sx-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
          <h3 className="m-0 text-base font-semibold">{label}</h3>
          {tab === 'general' && <General ws={ws} set={set} />}
          {tab === 'strategy' && <StrategyTab ws={ws} set={set} />}
          {tab === 'filter' && <FilterTab s={ws.settings} set={set} />}
          {tab === 'fields' && <FieldsTab s={ws.settings} set={set} />}
          {tab === 'levels' && <LevelsTab s={ws.settings} set={set} />}
        </div>
      </div>
    </Modal>
  );
}

function General({ ws, set }: { ws: Workspace; set: Set }) {
  const s = ws.settings;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Group title="Workspace">
        <Field label="Name">
          <input aria-label="Workspace name" className={INPUT} value={ws.name} maxLength={40} onChange={(e) => updateWorkspace(ws.uid, { name: e.target.value })} onBlur={(e) => { if (!e.target.value.trim()) updateWorkspace(ws.uid, { name: STRATEGY_BY_ID.get(ws.strategy)!.name }); }} />
        </Field>
        <Toggle checked={ws.enabled} onChange={(enabled) => updateWorkspace(ws.uid, { enabled })} label="Strategy on" hint="Off hides its tab and keeps its formations out of the feed." />
      </Group>
      <Group title="Exchange" hint="Formations are tracked per exchange.">
        <div role="group" aria-label="Exchange" className={`${SEG} flex-wrap`}>
          {EXCHANGE_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={ws.venue === id} onClick={() => updateWorkspace(ws.uid, { venue: id })} className={`${SEG_OPT} inline-flex items-center gap-1.5 px-2.5 ${ws.venue === id ? SEG_ACTIVE : SEG_IDLE}`}>
              <ExchangeIcon id={id} size={13} />{ADAPTERS[id].name}{ADAPTERS[id].market === 'perp' ? '' : ' Spot'}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Charts grid">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Chart timeframe"><Select label="Chart timeframe" value={s.chartTf} onChange={(chartTf) => set({ chartTf })} options={CHART_TF_OPTIONS} /></Field>
          <Field label="Charts per row" hint="Narrow screens use fewer."><Select label="Charts per row" value={s.columns} onChange={(columns) => set({ columns })} options={COLUMN_OPTIONS.map((c) => ({ value: c, label: String(c) }))} /></Field>
          <Field label="Max charts" hint={`1–${MAX_CHARTS}`}><NumberInput label="Max charts" value={s.maxCharts} min={1} max={MAX_CHARTS} step={1} onChange={(maxCharts) => set({ maxCharts })} /></Field>
        </div>
        <Field label="Default view"><Select label="Default view" value={s.view} onChange={(view) => set({ view })} options={[{ value: 'charts', label: 'Charts' }, { value: 'table', label: 'Table' }]} /></Field>
      </Group>
      <Group title="Remove">
        {confirm ? (
          <span className="flex items-center gap-2 text-[13px]">
            Remove “{ws.name}”?
            <button type="button" className={`${GHOST_BTN} text-sx-down`} onClick={() => { closeWorkspaceSettings(); selectStrategyTab('dashboard'); removeWorkspace(ws.uid); }}>Remove</button>
            <button type="button" className={GHOST_BTN} onClick={() => setConfirm(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className={`${GHOST_BTN} self-start`} onClick={() => setConfirm(true)}><Trash2 size={13} className="mr-1.5" aria-hidden="true" />Remove strategy</button>
        )}
      </Group>
    </>
  );
}

function StrategyTab({ ws, set }: { ws: Workspace; set: Set }) {
  const s = ws.settings;
  const def = STRATEGY_BY_ID.get(ws.strategy)!;
  const q = qualityOf(s.minScore);
  return (
    <>
      <Group title={def.name} hint={`${tfLabel(def)} candles`}>
        <p className="m-0 text-[12px] leading-relaxed text-sx-muted">{def.description}</p>
        <p className="m-0 text-[11px] leading-relaxed text-[#6B6E78]">{def.levels}</p>
      </Group>
      <Group title="Direction">
        <div className="flex gap-2">
          <CheckRow checked={s.long && def.dirs.includes('LONG')} disabled={!def.dirs.includes('LONG')} hint={def.dirs.includes('LONG') ? undefined : 'This strategy only trades shorts'} onChange={(long) => set({ long })} label={<span className="font-semibold text-sx-up">Long</span>} />
          <CheckRow checked={s.short && def.dirs.includes('SHORT')} disabled={!def.dirs.includes('SHORT')} hint={def.dirs.includes('SHORT') ? undefined : 'This strategy only trades longs'} onChange={(short) => set({ short })} label={<span className="font-semibold text-sx-down">Short</span>} />
        </div>
      </Group>
      {isMultiTf(def) && (
        <Group title="Timeframes" hint="Which candles’ setups to show. None ticked = all.">
          <div className="flex gap-2" role="group" aria-label="Timeframes">
            {def.tfs.map((t) => (
              <CheckRow key={t} checked={s.timeframes.includes(t)} onChange={(on) => set({ timeframes: def.tfs.filter((x) => (x === t ? on : s.timeframes.includes(x))) })} label={<span className="font-semibold">{t}</span>} />
            ))}
          </div>
        </Group>
      )}
      <Group title="Thresholds">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min Potential (%)" hint="Move from entry to TP2. 0 = any."><NumberInput label="Min Potential" value={s.minPotential} min={0} max={100} step={0.5} suffix="%" onChange={(minPotential) => set({ minPotential })} /></Field>
          <Field label="Max distance to entry (bps)" hint="How far price may be from entry. 100 bps = 1%. 0 = any."><NumberInput label="Max distance to entry" value={s.maxDistBps} min={0} max={10_000} step={10} suffix="bps" onChange={(maxDistBps) => set({ maxDistBps })} /></Field>
        </div>
        <Field label="Setup Quality score (min)" hint="LOW below 40 · MID 40–69 · HIGH 70+. Score adds structure strength, volume, order flow and daily-trend alignment.">
          <span className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={1} value={s.minScore} onChange={(e) => set({ minScore: e.target.valueAsNumber })} aria-label="Setup Quality score slider" className="min-w-0 flex-1 accent-[#30A46C]" />
            <span className="w-24"><NumberInput label="Setup Quality score" value={s.minScore} min={0} max={100} step={1} onChange={(minScore) => set({ minScore })} /></span>
            <span className="w-12 text-[11px] font-bold" style={{ color: QUALITY_COLOR[q] }} data-score-quality={q}>≥ {q}</span>
          </span>
        </Field>
      </Group>
      <Group title="Confirmations">
        <Toggle checked={s.orderFlow} onChange={(orderFlow) => set({ orderFlow })} label="Order-flow confirmed (Δ > 1σ)" hint="The trigger candle’s delta beats one standard deviation of the last 50 candles in the trade’s direction (delta estimated from candle body × volume)." />
        <Toggle checked={s.dailyTrend} onChange={(dailyTrend) => set({ dailyTrend })} label="Aligned with daily trend" hint="Rising (falling) 24-hour EMA on 1h candles with price above (below) it." />
      </Group>
    </>
  );
}

function FilterTab({ s, set }: { s: WorkspaceSettings; set: Set }) {
  const [draft, setDraft] = useState(s.exclude.join(', '));
  const toggleStage = (st: (typeof STAGES)[number], on: boolean) => set({ stages: STAGES.filter((x) => (x === st ? on : s.stages.includes(x))) });
  return (
    <>
      <Group title="Stages" hint="Which lifecycle stages the workspace shows.">
        <div className="grid gap-1 sm:grid-cols-2">
          {STAGES.map((st) => (
            <CheckRow key={st} checked={s.stages.includes(st)} onChange={(on) => toggleStage(st, on)} hint={STAGE_META[st].hint}
              label={<span className="inline-flex items-center gap-1.5 font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: STAGE_META[st].color }} aria-hidden="true" />{STAGE_META[st].label}</span>} />
          ))}
        </div>
      </Group>
      <Group title="Market">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min 24h volume"><Select label="Min 24h volume" value={s.minVolume} onChange={(minVolume) => set({ minVolume })} options={VOLUME_OPTIONS.some((o) => o.value === s.minVolume) ? VOLUME_OPTIONS : [...VOLUME_OPTIONS, { value: s.minVolume, label: `≥ $${s.minVolume}` }]} /></Field>
          <Field label="Max age (hours)" hint="Since first detected. 0 = any."><NumberInput label="Max age" value={s.maxAgeHours} min={0} max={168} step={1} suffix="h" onChange={(maxAgeHours) => set({ maxAgeHours })} /></Field>
        </div>
        <Field label="Exclude symbols" hint="Comma-separated, e.g. BTC, ETH. Settings → Sorting exceptions are always excluded.">
          <input aria-label="Exclude symbols" className={INPUT} value={draft} onChange={(e) => { setDraft(e.target.value); set({ exclude: e.target.value.toUpperCase().split(/[\s,]+/).filter(Boolean) }); }} />
        </Field>
      </Group>
      <Group title="Sorting">
        <Field label="Sort charts by"><Select label="Sort charts by" value={s.sort} onChange={(sort) => set({ sort })} options={FEED_SORTS} /></Field>
      </Group>
    </>
  );
}

function FieldsTab({ s, set }: { s: WorkspaceSettings; set: Set }) {
  const hidden = TABLE_FIELDS.filter((f) => !s.fields.includes(f.id));
  const name = (id: TableField) => TABLE_FIELDS.find((f) => f.id === id)!.label;
  return (
    <>
      <Group title="Shown columns" hint="Drag or use the arrows to order the workspace table.">
        <ReorderList
          label="Table columns"
          items={s.fields}
          render={(id) => <span title={TABLE_FIELDS.find((f) => f.id === id)!.hint}>{name(id)}</span>}
          onChange={(fields) => set({ fields })}
          trailing={(id) => (
            <button type="button" className={`${BTN_RESET} rounded px-1.5 text-[11px] text-sx-muted hover:text-sx-down`} disabled={s.fields.length === 1} onClick={() => set({ fields: s.fields.filter((x) => x !== id) })} aria-label={`Hide ${name(id)}`}>Hide</button>
          )}
        />
      </Group>
      {hidden.length > 0 && (
        <Group title="Hidden columns">
          <div className="flex flex-wrap gap-1.5">
            {hidden.map((f) => (
              <button key={f.id} type="button" title={f.hint} onClick={() => set({ fields: [...s.fields, f.id] })} className={`${BTN_RESET} rounded-lg border border-solid border-sx-line px-2.5 py-1 text-[12px] text-sx-muted hover:border-sx-line2 hover:text-sx-text`} aria-label={`Show ${f.label}`}>+ {f.label}</button>
            ))}
          </div>
        </Group>
      )}
    </>
  );
}

function LevelsTab({ s, set }: { s: WorkspaceSettings; set: Set }) {
  const row = (k: 'showEntry' | 'showSl' | 'showTp1' | 'showTp2', label: string, color: string, hint: string) => (
    <Toggle checked={s[k]} onChange={(v) => set({ [k]: v })} hint={hint} label={<span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 rounded" style={{ background: color }} aria-hidden="true" />{label}</span>} />
  );
  return (
    <>
      <Group title="Chart lines" hint="Drawn on every chart of the workspace and on the expanded chart.">
        {row('showEntry', 'Entry', LEVEL_COLORS.entry, 'Where the setup triggers.')}
        {row('showSl', 'SL', LEVEL_COLORS.sl, 'Stop loss — beyond it the setup is invalidated.')}
        {row('showTp1', 'TP1', LEVEL_COLORS.tp1, 'First target.')}
        {row('showTp2', 'TP2', LEVEL_COLORS.tp2, 'Second target (the potential is measured to it).')}
      </Group>
      <Group title="Labels">
        <Toggle checked={s.lineLabels} onChange={(lineLabels) => set({ lineLabels })} label="Line names on the price axis" hint="Entry / SL / TP1 / TP2 next to each price." />
        <Toggle checked={s.badge} onChange={(badge) => set({ badge })} label="Stage badge on charts" hint="Stage, direction, quality and potential in the chart corner." />
      </Group>
    </>
  );
}

'use client';

/**
 * Create / edit a screener filter: basic config (exchange, market, sort, mode),
 * ignored coins, and min / max bounds for any metric in the catalog.
 */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Info, X } from 'lucide-react';
import { BTN_RESET, GHOST_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import type { MarketType } from '@/lib/alerts/alertStore';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import { rankBy } from '@/lib/market/searchRank';
import type { Asset, ExchangeId } from '@/lib/market/types';
import { newFilterId } from '@/lib/screener/filters';
import type { Condition, Direction, ScreenerFilter } from '@/lib/screener/filters';
import { GROUPS, METRIC_BY_KEY, METRICS, metricsIn, unsupportedReason } from '@/lib/screener/metrics';
import type { GroupId, MetricDef } from '@/lib/screener/metrics';
import { passes } from '@/lib/screener/rank';
import { DropdownSelect, SegmentedGroup } from '../MarketControls';
import { ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import ModeSwitch from './ModeSwitch';

interface Row { min: string; max: string; direction: Direction }
interface Draft {
  name: string;
  exchange: ExchangeId;
  market: MarketType;
  sortMetric: string;
  sortDir: 'desc' | 'asc';
  enabled: boolean;
  ignore: string[];
  rows: Record<string, Row>;
}

const EMPTY_ROW: Row = { min: '', max: '', direction: 'any' };
const marketOf = (id: ExchangeId): MarketType => (ADAPTERS[id].market === 'perp' ? 'futures' : 'spot');
const MARKET_OPTS = [{ id: 'futures' as const, label: 'Futures' }, { id: 'spot' as const, label: 'Spot' }];
const DIR_LABEL: Record<Direction, string> = { any: 'Any', up: 'Up ↑', down: 'Down ↓' };
const SELECT = `${INPUT} cursor-pointer appearance-none pr-8 [&_optgroup]:bg-[#16171b] [&_option]:bg-[#16171b]`;

function toDraft(f: ScreenerFilter): Draft {
  return {
    name: f.name, exchange: f.exchange, market: f.market, sortMetric: f.sort.metric, sortDir: f.sort.dir, enabled: f.enabled,
    ignore: [...f.ignore],
    rows: Object.fromEntries(f.conditions.map((c) => [c.metric, {
      min: c.min === undefined ? '' : String(c.min), max: c.max === undefined ? '' : String(c.max), direction: c.direction ?? 'any',
    }])),
  };
}

const parseNum = (s: string): number | undefined => {
  const v = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(v) ? undefined : v;
};

function toConditions(rows: Record<string, Row>): Condition[] {
  return METRICS.flatMap((def) => {
    const r = rows[def.key];
    if (!r) return [];
    const min = parseNum(r.min), max = parseNum(r.max);
    if (min === undefined && max === undefined && (!def.directional || r.direction === 'any')) return [];
    return [{ metric: def.key, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(def.directional && r.direction !== 'any' ? { direction: r.direction } : {}) }];
  });
}

interface FilterBuilderProps {
  /** Filter being edited; null = new. */
  initial: ScreenerFilter | null;
  defaults: { exchange: ExchangeId; market: MarketType };
  /** Primary-venue coins (ignore suggestions, instant match estimate). */
  market: Asset[];
  primary: ExchangeId;
  onSave: (f: ScreenerFilter) => void;
  onCancel: () => void;
}

export default function FilterBuilder({ initial, defaults, market, primary, onSave, onCancel }: FilterBuilderProps) {
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(() => initial ? toDraft(initial) : {
    name: '', exchange: defaults.exchange, market: defaults.market, sortMetric: 'turnover', sortDir: 'desc', enabled: true, ignore: [], rows: {},
  });
  const [open, setOpen] = useState<ReadonlySet<GroupId>>(() => {
    const used = new Set(Object.keys(draft.rows).flatMap((k) => METRIC_BY_KEY.get(k)?.group ?? []));
    return used.size ? used : new Set<GroupId>(['last1m', 'range']);
  });
  const [ignoreQuery, setIgnoreQuery] = useState('');
  const [error, setError] = useState('');

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setRow = (key: string, patch: Partial<Row>) => setDraft((d) => ({ ...d, rows: { ...d.rows, [key]: { ...(d.rows[key] ?? EMPTY_ROW), ...patch } } }));
  const venueName = ADAPTERS[draft.exchange].name;
  const conditions = toConditions(draft.rows);
  const counts = new Map<GroupId, number>();
  for (const c of conditions) {
    const g = METRIC_BY_KEY.get(c.metric)?.group;
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  // Instant estimate: live-data conditions + ignore list, on the primary venue's coins.
  const instant = conditions.filter((c) => METRIC_BY_KEY.get(c.metric)?.needs.length === 0);
  const estimate = draft.exchange === primary
    ? market.filter((a) => !draft.ignore.includes(a.symbol) && instant.every((c) => passes(c, METRIC_BY_KEY.get(c.metric)!.compute({
      bars: {}, btc: {}, price: a.history[a.history.length - 1] ?? 0, funding: a.funding, turnover: a.volume,
    })))).length
    : null;
  const heavyCount = conditions.length - instant.length;

  const suggestions = ignoreQuery.trim()
    ? rankBy(market.filter((a) => !draft.ignore.includes(a.symbol)), (a) => a.symbol, ignoreQuery).slice(0, 8)
    : [];
  const addIgnore = (symbol: string) => { set({ ignore: [...draft.ignore, symbol] }); setIgnoreQuery(''); };

  const pickMarket = (m: MarketType) => {
    if (m === draft.market) return;
    const exchange = marketOf(draft.exchange) === m ? draft.exchange : EXCHANGE_IDS.find((id) => marketOf(id) === m) ?? draft.exchange;
    set({ market: m, exchange });
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name) { setError('Give the filter a name.'); return; }
    for (const c of conditions) {
      if (c.min !== undefined && c.max !== undefined && c.min > c.max) { setError(`${METRIC_BY_KEY.get(c.metric)?.name}: min is above max.`); return; }
    }
    onSave({
      id: initial?.id ?? newFilterId(),
      name, exchange: draft.exchange, market: draft.market,
      sort: { metric: draft.sortMetric, dir: draft.sortDir },
      enabled: draft.enabled, ignore: draft.ignore, conditions, createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <>
      <div className="sx-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Basic config */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${ids}-name`}>
            <input id={`${ids}-name`} className={INPUT} value={draft.name} onChange={(e) => { set({ name: e.target.value }); setError(''); }} placeholder="e.g. Volatile movers" maxLength={40} autoFocus />
          </Field>
          <Field label="Exchange">
            <DropdownSelect<ExchangeId> label="Exchange" options={EXCHANGE_IDS.filter((id) => marketOf(id) === draft.market)} value={draft.exchange} onChange={(v) => set({ exchange: v })} render={(id) => <ExchangeLabel id={id} size={14} />} />
          </Field>
          <Field label="Market">
            <SegmentedGroup label="Filter market" options={MARKET_OPTS} value={draft.market} onChange={pickMarket} />
          </Field>
          <Field label="Mode" hint="Enabled filters drive the Market Map (one at a time)">
            <ModeSwitch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={draft.enabled ? 'Enabled' : 'Disabled'} showLabel />
          </Field>
          <Field label="Sort" htmlFor={`${ids}-sort`} className="sm:col-span-2" hint="Ranks the matches; the grid shows the top ones">
            <div className="flex gap-2">
              <SelectBox id={`${ids}-sort`} value={draft.sortMetric} onChange={(v) => set({ sortMetric: v })}>
                {GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.title}>
                    {metricsIn(g.id).map((d) => <option key={d.key} value={d.key} disabled={unsupportedReason(d, draft.exchange, venueName) !== null}>{d.name}</option>)}
                  </optgroup>
                ))}
              </SelectBox>
              <button
                type="button"
                onClick={() => set({ sortDir: draft.sortDir === 'desc' ? 'asc' : 'desc' })}
                aria-label={`Sort direction: ${draft.sortDir === 'desc' ? 'highest first' : 'lowest first'}`}
                title={draft.sortDir === 'desc' ? 'Highest first' : 'Lowest first'}
                className={`${GHOST_BTN} shrink-0 gap-1.5 px-3`}
              >
                {draft.sortDir === 'desc' ? <ArrowDownWideNarrow size={15} aria-hidden="true" /> : <ArrowUpNarrowWide size={15} aria-hidden="true" />}
                {draft.sortDir === 'desc' ? 'High → low' : 'Low → high'}
              </button>
            </div>
          </Field>
        </div>

        {/* Ignore coins */}
        <div className="mt-4">
          <Field label="Ignore coins" htmlFor={`${ids}-ign`} hint="These coins never match">
            <div className="relative">
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-solid border-sx-line bg-sx-bg/60 px-2 py-1.5 focus-within:border-sx-up">
                {draft.ignore.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] py-0.5 pl-2 pr-1 text-xs font-semibold">
                    {s}
                    <button type="button" aria-label={`Stop ignoring ${s}`} onClick={() => set({ ignore: draft.ignore.filter((x) => x !== s) })} className={`${BTN_RESET} grid h-4 w-4 place-items-center rounded text-sx-muted hover:text-sx-text`}>
                      <X size={11} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <input
                  id={`${ids}-ign`}
                  value={ignoreQuery}
                  onChange={(e) => setIgnoreQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && suggestions[0]) { e.preventDefault(); addIgnore(suggestions[0].symbol); }
                    else if (e.key === 'Backspace' && !ignoreQuery && draft.ignore.length) set({ ignore: draft.ignore.slice(0, -1) });
                  }}
                  placeholder={draft.ignore.length ? '' : 'Search coins to ignore…'}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-24 flex-1 border-0 bg-transparent p-1 font-[inherit] text-[13px] text-sx-text outline-none placeholder:text-[#5F626C]"
                />
              </div>
              {suggestions.length > 0 && (
                <div role="listbox" aria-label="Coins to ignore" className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-solid border-sx-line2 bg-[#16171b] p-1 shadow-xl shadow-black/60">
                  {suggestions.map((a) => (
                    <button key={a.symbol} type="button" role="option" aria-selected="false" onClick={() => addIgnore(a.symbol)} className={`${BTN_RESET} block w-full rounded-md px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-white/[0.07]`}>
                      {a.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </div>

        {/* Metric sections */}
        <div className="mt-5 flex flex-col gap-2">
          {GROUPS.map((g) => {
            const isOpen = open.has(g.id);
            const n = counts.get(g.id) ?? 0;
            return (
              <section key={g.id} className="rounded-xl border border-solid border-sx-line bg-white/[0.02]">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`${ids}-${g.id}`}
                  onClick={() => setOpen((s) => { const next = new Set(s); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); return next; })}
                  className={`${BTN_RESET} flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-semibold`}
                >
                  <ChevronDown size={14} className={`text-sx-muted transition-transform ${isOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                  {g.title}
                  {n > 0 && <span className="rounded-full bg-sx-up/15 px-1.5 text-[10px] text-sx-up">{n}</span>}
                  {g.hint && <span className="ml-auto hidden truncate text-[11px] font-normal text-sx-muted sm:inline">{g.hint}</span>}
                </button>
                {isOpen && (
                  <div id={`${ids}-${g.id}`} className="border-0 border-t border-solid border-sx-line px-3.5 pb-3 pt-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_84px] items-center gap-x-2 gap-y-1.5 text-xs">
                      <span className="text-[10px] uppercase tracking-wide text-sx-muted">Metric</span>
                      <span className="text-[10px] uppercase tracking-wide text-sx-muted">From</span>
                      <span className="text-[10px] uppercase tracking-wide text-sx-muted">Until</span>
                      <span className="text-[10px] uppercase tracking-wide text-sx-muted">Direction</span>
                      {metricsIn(g.id).map((d) => (
                        <MetricRow key={d.key} def={d} row={draft.rows[d.key] ?? EMPTY_ROW} reason={unsupportedReason(d, draft.exchange, venueName)} onChange={(p) => setRow(d.key, p)} />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-sx-line px-5 py-3">
        <span className="mr-auto text-xs text-sx-muted" aria-live="polite">
          {error ? <span className="text-sx-down">{error}</span>
            : `${conditions.length} condition${conditions.length === 1 ? '' : 's'}${estimate === null ? '' : ` · ${estimate} of ${market.length} pass the instant checks`}${heavyCount ? ' · the rest scan once enabled' : ''}`}
        </span>
        <button type="button" onClick={onCancel} className={GHOST_BTN}>Cancel</button>
        <button type="button" onClick={save} className={PRIMARY_BTN}>{initial ? 'Save changes' : 'Create filter'}</button>
      </div>
    </>
  );
}

function MetricRow({ def, row, reason, onChange }: { def: MetricDef; row: Row; reason: string | null; onChange: (p: Partial<Row>) => void }) {
  const unit = def.unit === '%' ? '%' : def.unit === '$' ? '$' : '';
  const input = (key: 'min' | 'max', label: string) => (
    <span className="relative">
      <input
        aria-label={`${def.name} ${label}`}
        className={`${INPUT} px-2 py-1.5 text-xs tabular-nums ${unit ? 'pr-5' : ''}`}
        inputMode="decimal"
        value={row[key]}
        onChange={(e) => onChange({ [key]: e.target.value.replace(/[^\d.,-]/g, '') })}
        placeholder="any"
        title={key === 'min' ? 'From (empty = any)' : 'Until (empty = any)'}
        disabled={reason !== null}
      />
      {unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-sx-muted">{unit}</span>}
    </span>
  );
  return (
    <>
      <span className={`flex min-w-0 items-center gap-1.5 ${reason ? 'text-sx-muted' : ''}`} title={reason ?? def.hint}>
        <span className="truncate">{def.label}</span>
        {(reason || def.hint) && <Info size={12} className="shrink-0 text-sx-muted" aria-hidden="true" />}
        {reason && <span className="sr-only">({reason})</span>}
      </span>
      {input('min', 'from')}
      {input('max', 'until')}
      {def.directional ? (
        <SelectBox value={row.direction} onChange={(v) => onChange({ direction: v as Direction })} label={`${def.name} direction`} disabled={reason !== null} compact>
          {(Object.keys(DIR_LABEL) as Direction[]).map((d) => <option key={d} value={d}>{DIR_LABEL[d]}</option>)}
        </SelectBox>
      ) : <span aria-hidden="true" />}
    </>
  );
}

function SelectBox({ id, value, onChange, children, label, disabled, compact }: { id?: string; value: string; onChange: (v: string) => void; children: ReactNode; label?: string; disabled?: boolean; compact?: boolean }) {
  return (
    <span className="relative block min-w-0 flex-1">
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${SELECT} ${compact ? 'px-2 py-1.5 pr-6 text-xs' : ''} disabled:cursor-not-allowed disabled:opacity-50`}>
        {children}
      </select>
      <ChevronDown size={compact ? 12 : 14} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-sx-muted ${compact ? 'right-1.5' : 'right-2.5'}`} aria-hidden="true" />
    </span>
  );
}

function Field({ label, htmlFor, hint, className = '', children }: { label: string; htmlFor?: string; hint?: string; className?: string; children: ReactNode }) {
  const note = hint && <span className="ml-1.5 text-[11px] text-[#5F626C]">· {hint}</span>;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {htmlFor ? <label htmlFor={htmlFor} className="text-xs text-sx-muted">{label}{note}</label> : <span className="text-xs text-sx-muted">{label}{note}</span>}
      {children}
    </div>
  );
}

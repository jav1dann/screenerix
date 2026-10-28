'use client';

/** Shared pieces of the Strategies views: badges, the view switch, formation cards and the formation table. */
import { memo } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, LayoutGrid, Rows3, Waves, TrendingUp } from 'lucide-react';
import { SEG, SEG_ACTIVE, SEG_IDLE, SEG_OPT } from '@/components/terminal/MarketControls';
import { BTN_RESET } from '@/components/chart/styles';
import { fmtPrice, fmtUsd } from '@/lib/format';
import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import { isMultiTf, STAGE_META, STRATEGY_BY_ID } from '@/lib/strategies/catalog';
import { LEVEL_COLORS } from '@/lib/strategies/chartLines';
import type { TradeLevels } from '@/lib/strategies/chartLines';
import { TABLE_FIELDS } from '@/lib/strategies/store';
import type { TableField, WorkspaceSettings } from '@/lib/strategies/store';
import type { Timeframe } from '@/lib/market/exchanges';
import { distanceBps, qualityOf } from '@/lib/strategies/types';
import type { Direction, Formation, Quality, Stage } from '@/lib/strategies/types';
import StrategyAlertButton from './StrategyAlertButton';

/** A setup's one-click alert target: its strategy, coin, timeframe and side. */
const alertTarget = (f: Formation) => ({ exchange: f.venue, symbol: f.symbol, strategy: f.strategy, tf: f.tf, dir: f.dir });

export const QUALITY_COLOR: Record<Quality, string> = { LOW: '#8B8D98', MID: '#E5B931', HIGH: '#30A46C' };

export function fmtAge(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
export const fmtBps = (bps: number) => (Number.isFinite(bps) ? `${Math.round(bps)} bps` : '—');

export function StageBadge({ stage, size = 'sm' }: { stage: Stage; size?: 'sm' | 'xs' }) {
  const m = STAGE_META[stage];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md font-bold tracking-wide ${size === 'xs' ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}
      style={{ color: m.color, background: `${m.color}22`, boxShadow: `inset 0 0 0 1px ${m.color}44` }}
      title={m.hint}
      data-stage={stage}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
      {stage}
    </span>
  );
}

export function DirPill({ dir }: { dir: Direction }) {
  const long = dir === 'LONG';
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${long ? 'bg-sx-up/15 text-sx-up' : 'bg-sx-down/15 text-sx-down'}`} title={long ? 'Long setup' : 'Short setup'} data-dir={dir}>
      {long ? <ArrowUpRight size={11} aria-hidden="true" /> : <ArrowDownRight size={11} aria-hidden="true" />}{dir}
    </span>
  );
}

export function QualityPill({ quality, score }: { quality: Quality; score: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold" style={{ color: QUALITY_COLOR[quality] }} title={`Setup quality ${quality} · score ${score}/100`} data-quality={quality}>
      {quality}<span className="font-semibold text-sx-muted tabular-nums">{score}</span>
    </span>
  );
}

/** Order-flow / daily-trend confirmations. */
export function Flags({ f }: { f: Formation }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span title={f.orderFlow ? 'Order flow confirmed: the trigger candle’s delta is above 1σ in the trade’s direction (delta estimated from candle body × volume)' : 'No order-flow confirmation'} className={f.orderFlow ? 'text-sx-up' : 'text-[#45484F]'}>
        <Waves size={12} aria-label={f.orderFlow ? 'Order flow confirmed' : 'No order-flow confirmation'} />
      </span>
      <span title={f.dailyAligned ? 'Aligned with the daily trend' : 'Not aligned with the daily trend'} className={f.dailyAligned ? 'text-sx-up' : 'text-[#45484F]'}>
        <TrendingUp size={12} aria-label={f.dailyAligned ? 'Aligned with daily trend' : 'Not aligned with daily trend'} />
      </span>
    </span>
  );
}

export function ViewSwitch<T extends string>({ value, onChange, label, options }: { value: T; onChange: (v: T) => void; label: string; options: ReadonlyArray<{ value: T; label: string }> }) {
  return (
    <div role="group" aria-label={label} className={SEG}>
      {options.map((o, i) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`${SEG_OPT} inline-flex items-center gap-1 px-2.5 ${value === o.value ? SEG_ACTIVE : SEG_IDLE}`}>
          {i === 0 ? <LayoutGrid size={12} aria-hidden="true" /> : <Rows3 size={12} aria-hidden="true" />}{o.label}
        </button>
      ))}
    </div>
  );
}
export const CARDS_TABLE = [{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }] as const;

/** The chart timeframe for a formation: the workspace's, or the formation's own ("Setup timeframe"). */
export const chartTfFor = (f: Pick<Formation, 'tf'>, s?: Pick<WorkspaceSettings, 'chartTf'>): Timeframe => (!s || s.chartTf === 'setup' ? f.tf : s.chartTf);

export function TfChip({ tf }: { tf: Timeframe }) {
  return <span className="shrink-0 rounded bg-white/[0.08] px-1 text-[9px] font-bold text-sx-text" title={`Found on ${tf} candles`} data-tf={tf}>{tf}</span>;
}

/** Chart levels of a formation through a workspace's Levels settings. */
export function tradeLevelsOf(f: Pick<Formation, 'entry' | 'sl' | 'tp1' | 'tp2' | 'dir' | 'anchorT'>, s?: WorkspaceSettings): TradeLevels {
  return {
    entry: f.entry, sl: f.sl, tp1: f.tp1, tp2: f.tp2, dir: f.dir, anchorT: f.anchorT,
    show: s ? { entry: s.showEntry, sl: s.showSl, tp1: s.showTp1, tp2: s.showTp2, labels: s.lineLabels } : undefined,
  };
}

/** A continuation setup still outside the range after its sweep: its "SL" is only where the structure fails. */
const provisionalStop = (f: Pick<Formation, 'strategy' | 'stage'>) =>
  f.stage === 'FORMING' && (f.strategy === 'longContinuationSweep' || f.strategy === 'shortContinuationSweep');
const PROVISIONAL_HINT = 'Invalidation (impulse origin) while price is outside the range after the sweep. The stop goes behind the sweep wick once price closes back inside.';

function Level({ k, v, provisional }: { k: 'entry' | 'sl' | 'tp1' | 'tp2'; v: number; provisional?: boolean }) {
  const label = provisional ? 'Invalid.' : { entry: 'Entry', sl: 'SL', tp1: 'TP1', tp2: 'TP2' }[k];
  return (
    <span className="flex flex-col" title={provisional ? PROVISIONAL_HINT : undefined}>
      <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: LEVEL_COLORS[k] }}>{label}</span>
      <span className="tabular-nums text-sx-text" data-level={k}>{fmtPrice(v)}</span>
    </span>
  );
}

const STRENGTH_HINT = 'Strength index: how strongly the market confirmed the sweep — volume, the reclaim candle, lower-timeframe RSI, the liquidity pool, structure and trend. A heuristic score, not a back-tested win rate.';

/** The strength index ("индекс силы") as a small meter; `compact` for table cells. */
export function StrengthMeter({ strength, compact = false }: { strength: NonNullable<Formation['strength']>; compact?: boolean }) {
  const color = QUALITY_COLOR[qualityOf(strength.value)];
  const title = `${STRENGTH_HINT}\n\n${strength.factors.length ? strength.factors.map((x) => `• ${x}`).join('\n') : 'No confirming factors yet.'}`;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={title} data-strength={strength.value}>
      {!compact && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-sx-muted">Strength</span>}
      <span className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${strength.value}%`, background: color }} />
      </span>
      <b className="shrink-0 tabular-nums" style={{ color }}>{strength.value}%</b>
      {!compact && strength.factors.length > 0 && <span className="truncate text-sx-muted" data-strength-factors>{strength.factors.slice(0, 2).join(' · ')}</span>}
    </span>
  );
}

export const FormationCard = memo(function FormationCard({ f, now, onOpen, action }: { f: Formation; now: number; onOpen: () => void; action?: ReactNode }) {
  const def = STRATEGY_BY_ID.get(f.strategy)!;
  return (
    <article
      className="sx-glass flex cursor-pointer flex-col gap-2 p-3 text-[11px] transition-colors hover:border-sx-line2 focus-visible:outline-2 focus-visible:outline-sx-up"
      data-formation={f.id}
      tabIndex={0}
      role="button"
      aria-label={`${f.symbol} ${f.dir} ${def.name} — ${f.stage}. Open chart`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <header className="flex items-center gap-1.5">
        <span className="truncate text-sm font-extrabold" data-symbol>{f.symbol}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-white/[0.06] px-1 text-[9px] font-bold text-sx-muted"><ExchangeIcon id={f.venue} size={10} />{ADAPTERS[f.venue].name}</span>
        {isMultiTf(def) && <TfChip tf={f.tf} />}
        <DirPill dir={f.dir} />
        <span className="ml-auto" />
        <StrategyAlertButton target={alertTarget(f)} forming={f.stage === 'FORMING'} />
        <StageBadge stage={f.stage} />
      </header>
      <div className="flex items-center gap-1.5 text-sx-muted">
        <span className="truncate" title={f.note}>{def.name}</span>
        <span className="ml-auto" />
        <QualityPill quality={f.quality} score={f.score} />
        <Flags f={f} />
      </div>
      <div className="grid grid-cols-4 gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5">
        <Level k="entry" v={f.entry} /><Level k="sl" v={f.sl} provisional={provisionalStop(f)} /><Level k="tp1" v={f.tp1} /><Level k="tp2" v={f.tp2} />
      </div>
      {f.strength && <div className="flex min-w-0 items-center" data-strength-row><StrengthMeter strength={f.strength} /></div>}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums text-sx-muted">
        <span title="Move from entry to TP2">Potential <b className="text-sx-up" data-potential={f.potential.toFixed(4)}>{f.potential.toFixed(2)}%</b></span>
        <span title="Distance from the last price to entry">To entry <b className="text-sx-text">{fmtBps(distanceBps(f, f.price))}</b></span>
        <span title="24h turnover">Vol <b className="text-sx-text">{fmtUsd(f.volume24h)}</b></span>
        <span title="Time since first detected" data-age={now - f.detectedAt}>Age <b className="text-sx-text">{fmtAge(now - f.detectedAt)}</b></span>
        {action && <span className="ml-auto">{action}</span>}
      </footer>
    </article>
  );
});

function cell(f: Formation, k: TableField, now: number): ReactNode {
  switch (k) {
    case 'symbol': return <span className="font-bold text-sx-text">{f.symbol}</span>;
    case 'strategy': return STRATEGY_BY_ID.get(f.strategy)!.name;
    case 'tf': return f.tf;
    case 'venue': return <ExchangeLabel id={f.venue} size={13} />;
    case 'stage': return <StageBadge stage={f.stage} size="xs" />;
    case 'dir': return <DirPill dir={f.dir} />;
    case 'quality': return <QualityPill quality={f.quality} score={f.score} />;
    case 'potential': return <span className="text-sx-up" data-potential={f.potential.toFixed(4)}>{f.potential.toFixed(2)}%</span>;
    case 'price': return fmtPrice(f.price);
    case 'entry': return <span style={{ color: LEVEL_COLORS.entry }}>{fmtPrice(f.entry)}</span>;
    case 'sl': return provisionalStop(f)
      ? <span style={{ color: LEVEL_COLORS.sl }} title={PROVISIONAL_HINT}>{fmtPrice(f.sl)}<span className="text-sx-muted">*</span></span>
      : <span style={{ color: LEVEL_COLORS.sl }}>{fmtPrice(f.sl)}</span>;
    case 'strength': return f.strength ? <StrengthMeter strength={f.strength} compact /> : <span className="text-sx-muted">—</span>;
    case 'tp1': return <span style={{ color: LEVEL_COLORS.tp1 }}>{fmtPrice(f.tp1)}</span>;
    case 'tp2': return <span style={{ color: LEVEL_COLORS.tp2 }}>{fmtPrice(f.tp2)}</span>;
    case 'distance': return fmtBps(distanceBps(f, f.price));
    case 'volume': return fmtUsd(f.volume24h);
    case 'age': return fmtAge(now - f.detectedAt);
    case 'flags': return <Flags f={f} />;
  }
}

export function FormationTable({ rows, fields, now, onOpen, label }: { rows: readonly Formation[]; fields: readonly TableField[]; now: number; onOpen: (f: Formation) => void; label: string }) {
  const cols = fields.map((id) => TABLE_FIELDS.find((x) => x.id === id)!).filter(Boolean);
  return (
    <div className="sx-glass sx-scroll overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" aria-label={label} data-formation-table>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-sx-muted">
            {cols.map((c) => <th key={c.id} scope="col" title={c.hint} className="whitespace-nowrap border-0 border-b border-solid border-sx-line px-3 py-2 font-semibold">{c.label}</th>)}
            <th scope="col" className="w-8 border-0 border-b border-solid border-sx-line px-2 py-2 font-semibold"><span className="sr-only">Alert</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id} data-formation={f.id} className="cursor-pointer tabular-nums text-sx-muted hover:bg-white/[0.03]" onClick={() => onOpen(f)}>
              {cols.map((c, i) => (
                <td key={c.id} className="whitespace-nowrap border-0 border-b border-solid border-sx-line/60 px-3 py-1.5">
                  {i === 0
                    ? <button type="button" className={`${BTN_RESET} text-left focus-visible:outline-2 focus-visible:outline-sx-up`} onClick={(e) => { e.stopPropagation(); onOpen(f); }} aria-label={`Open ${f.symbol} ${f.dir} chart`}>{cell(f, c.id, now)}</button>
                    : cell(f, c.id, now)}
                </td>
              ))}
              <td className="border-0 border-b border-solid border-sx-line/60 px-2 py-1"><StrategyAlertButton target={alertTarget(f)} forming={f.stage === 'FORMING'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

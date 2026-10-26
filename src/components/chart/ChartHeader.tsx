import { ChevronUp, Expand, SquareFunction } from 'lucide-react';
import { IconGear } from '@/components/shared/icons';
import { useColorRules, useSettings } from '@/hooks/useTerminal';
import { fmtCount, fmtPct, fmtPrice, fmtUsd, tone } from '@/lib/format';
import type { ChartStats } from '@/lib/market/chartStream';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { isRangeWindow } from '@/lib/market/terminalPrefs';
import type { ConnState } from '@/lib/market/types';
import { ruleColor } from '@/lib/screener/colorRules';
import type { ColorRules } from '@/lib/screener/colorRules';
import { fmtMetric, METRIC_BY_KEY, unsupportedReason } from '@/lib/screener/metrics';
import { indicatorLabel, sortLabel, sortMetric } from '@/lib/settings/settings';
import type { IndicatorId, IndicatorSize, SortPref } from '@/lib/settings/settings';
import { openSettings } from '@/lib/settings/settingsUi';
import { BTN_RESET, ICON_BTN } from './styles';

interface ChartHeaderProps {
  symbol: string;
  quote: string;
  venueLabel: string;
  stats: ChartStats;
  /** The Market Map sort, shown by the "Sort metric" indicator (e.g. "5m Range"). */
  sort: SortPref;
  /** Server-scanned metric values of this coin (for catalog indicators). */
  metrics?: Readonly<Record<string, number | null | undefined>>;
  /** The card's venue: metrics it can't compute read "n/a" (with the reason) instead of "—". */
  exchange?: ExchangeId;
  /** Live funding rate (fraction); null = not received yet. Undefined: no funding pair (spot, previews). */
  funding?: number | null;
  conn: ConnState;
  /** Opens the Indicator modal (absent: no button). */
  onIndicators?: () => void;
  /** Gear action; defaults to opening Settings → Indicators Above the Chart. */
  onSettingsClick?: () => void;
  /** Opens the expanded terminal; also makes the symbol title clickable. */
  onExpand?: () => void;
  /** Stats banner folded away (slim header). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** Height-collapsible region (CSS grid rows 1fr ↔ 0fr animates to/from auto height). */
const fold = (collapsed: boolean) =>
  `grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`;

const CONN_DOT: Partial<Record<ConnState, string>> = { live: 'bg-sx-up', error: 'bg-sx-down', connecting: 'bg-sx-alert', reconnecting: 'bg-sx-alert' };

/** Compact type scale of the inline label · value pairs (Settings → Indicators → size). */
const SIZE: Record<IndicatorSize, { label: string; value: string; row: string }> = {
  xs: { label: 'text-[8.5px]', value: 'text-[10px]', row: 'h-[12px]' },
  sm: { label: 'text-[9px]', value: 'text-[11px]', row: 'h-[13px]' },
  md: { label: 'text-[9.5px]', value: 'text-xs', row: 'h-[14px]' },
  lg: { label: 'text-[10px]', value: 'text-[13px]', row: 'h-[15px]' },
  xl: { label: 'text-[11px]', value: 'text-sm', row: 'h-[17px]' },
};

function Stat({ label, value, sub, color, size }: { label: string; value: string; sub?: string; color?: string; size: IndicatorSize }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap leading-none" data-indicator={label} title={sub}>
      <span className={`${SIZE[size].label} font-medium uppercase tracking-wide text-sx-muted`}>{label}</span>
      <span className={`truncate ${SIZE[size].value} font-semibold tabular-nums text-sx-text`} style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

interface Reading { label: string; value: string; sub?: string; color?: string }
/** Header icon buttons, a size down from the toolbar's so they don't set the header height. */
const HDR_ICON = ICON_BTN.replace('h-7 w-7', 'h-6 w-6');
const DASH = '—';
const NA = 'n/a';
const pct = (v: number | null) => (v === null ? DASH : fmtPct(v).replace('+', ''));
/** Live stats are fractions; color rules use display percent. */
const asPct = (v: number | null) => (v === null ? null : v * 100);

interface ReadCtx {
  stats: ChartStats;
  sort: SortPref;
  metrics: ChartHeaderProps['metrics'];
  exchange?: ExchangeId;
  rules: ColorRules;
}

/** Label + formatted value (+ rule color) of one indicator. */
function readIndicator(id: IndicatorId, x: ReadCtx): Reading {
  const { stats, sort, metrics, rules } = x;
  switch (id) {
    case 'sort': {
      // A Range sort reads the card's own live candles; other sorts read the server scan.
      if (sort.mode === 'range' && isRangeWindow(sort.window)) {
        const v = stats.ranges[sort.window];
        return { label: `${sort.window} range`, value: pct(v), color: ruleColor(rules, sortMetric(sort), asPct(v)) };
      }
      return { ...readIndicator(sortMetric(sort), x), label: sortLabel(sort) };
    }
    case 'range24h':
      return {
        label: 'Daily range', value: pct(stats.range24h), color: ruleColor(rules, 'range24h', asPct(stats.range24h)),
        sub: stats.low24h !== null && stats.high24h !== null ? `${fmtPrice(stats.low24h)} – ${fmtPrice(stats.high24h)}` : undefined,
      };
    case 'change24h':
      return {
        label: 'Daily change', value: stats.change24h === null ? DASH : fmtPct(stats.change24h),
        color: stats.change24h === null ? undefined : ruleColor(rules, 'change24h', asPct(stats.change24h)) ?? tone(stats.change24h),
      };
    case 'trades24h':
      return { label: 'Daily trades', value: stats.trades24h === null ? DASH : fmtCount(stats.trades24h), color: ruleColor(rules, 'trades24h', stats.trades24h) };
    case 'volume24h':
      return { label: 'Daily volume', value: stats.volume24h === null ? DASH : fmtUsd(stats.volume24h), color: ruleColor(rules, 'volume24h', stats.volume24h) };
    default: {
      const def = METRIC_BY_KEY.get(id);
      const label = def?.name ?? indicatorLabel(id);
      // The venue can't compute it at all (no trade counts / OI history): say so instead of an endless "—".
      const why = def && x.exchange ? unsupportedReason(def, x.exchange, ADAPTERS[x.exchange].name) : null;
      if (why) return { label, value: NA, sub: why };
      const v = metrics?.[id];
      return def && typeof v === 'number' ? { label, value: fmtMetric(def.unit, v), color: ruleColor(rules, id, v) } : { label, value: DASH };
    }
  }
}

/** The live funding rate (fraction), shown on every perpetual card. */
function readFunding(f: number | null, rules: ColorRules): Reading {
  if (f === null) return { label: 'Fund.', value: DASH };
  return { label: 'Fund.', value: fmtPct(f, 4), color: ruleColor(rules, 'funding', f * 100) ?? tone(f), sub: 'Current funding rate' };
}

export default function ChartHeader({ symbol, quote, venueLabel, stats, sort, metrics, exchange, funding, conn, onIndicators, onSettingsClick, onExpand, collapsed = false, onToggleCollapsed }: ChartHeaderProps) {
  const { indicators } = useSettings();
  const rules = useColorRules();
  const ctx: ReadCtx = { stats, sort, metrics, exchange, rules };
  const items = indicators.items.map((id) => ({ id, ...readIndicator(id, ctx) }));
  // Funding is always shown on perp cards — second, so a narrow card's one-line row never clips it.
  const readings = funding === undefined ? items : [...items.slice(0, 1), { id: 'funding:live', ...readFunding(funding, rules) }, ...items.slice(1)];
  const first = readings[0];
  const title = (
    <>
      {symbol}<span className="font-normal text-sx-muted @max-[16rem]:hidden">/{quote}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${CONN_DOT[conn] ?? 'bg-sx-line2'}`} title={conn} />
      {/* Collapsed: keep the live price visible inline. */}
      {collapsed && stats.last !== null && <span className="ml-1 text-xs font-semibold tabular-nums text-sx-text">{fmtPrice(stats.last)}</span>}
    </>
  );
  return (
    <div className={`flex items-center gap-3 border-b border-sx-line px-2.5 transition-[padding] duration-200 motion-reduce:transition-none ${collapsed ? 'py-0.5' : 'py-1'}`} data-card-header>
      <div className="flex min-w-0 shrink-0 flex-col overflow-hidden leading-tight">
        {onExpand ? (
          <button type="button" onClick={onExpand} title={`Open ${symbol} in the full terminal`} className={`${BTN_RESET} flex items-center gap-1.5 text-left text-xs font-bold hover:text-white`}>
            {title}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-bold">{title}</span>
        )}
        <div className={fold(collapsed)} aria-hidden={collapsed}>
          <span className="min-h-0 overflow-hidden truncate text-[9.5px] text-sx-muted">
            {exchange && <ExchangeIcon id={exchange} size={10} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }} />}{venueLabel}{stats.last !== null && <> · <span className="text-sx-text">{fmtPrice(stats.last)}</span></>}
          </span>
        </div>
      </div>
      <div className={`${fold(collapsed)} min-w-0 flex-1 @max-[26rem]:hidden`} aria-hidden={collapsed}>
      {/* One line, always: pairs that don't fit wrap out of the clipped row (they stay in the narrow-card pill / settings). */}
      <div className={`flex min-w-0 flex-wrap items-baseline justify-end gap-x-3 gap-y-4 overflow-hidden ${collapsed ? 'min-h-0' : SIZE[indicators.size].row}`}>
        {readings.map((r) => <Stat key={r.id} label={r.label} value={r.value} sub={r.sub} color={r.color} size={indicators.size} />)}
      </div>
      </div>
      {!collapsed && first && (
        <span className="ml-auto hidden shrink-0 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sx-muted @max-[26rem]:inline @max-[16rem]:hidden" title={first.label}>
          {first.label} <span className="text-sx-text">{first.value}</span>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center">
        {onExpand && (
          <button type="button" className={HDR_ICON} onClick={onExpand} aria-label={`Expand ${symbol} chart`} title="Expand">
            <Expand size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {onIndicators && (
          <button type="button" className={HDR_ICON} onClick={onIndicators} aria-label="Indicators" title="Indicators" aria-haspopup="dialog">
            <SquareFunction size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {indicators.showSettingsBadge && (
          <button type="button" className={HDR_ICON} onClick={onSettingsClick ?? (() => openSettings('indicators'))} aria-label="Chart settings" title="Indicator settings">
            <IconGear />
          </button>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            className={HDR_ICON}
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show chart details' : 'Hide chart details'}
            title={collapsed ? 'Show details' : 'Hide details'}
          >
            <ChevronUp size={15} strokeWidth={2} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}

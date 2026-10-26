'use client';

/**
 * Terminal header controls: Futures / Spot toggle, Range window, card Timeframe
 * group, Grid layout and the action buttons. Built from two generic pieces — a segmented radio group
 * and a dropdown select — so they share look, keyboard and menu behaviour.
 */
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown, FunnelPlus, LayoutGrid, Search, Settings } from 'lucide-react';
import { BTN_RESET } from '@/components/chart/styles';
import Popover from '@/components/shared/Popover';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { Timeframe } from '@/lib/market/exchanges';
import { gridLabel, gridLayout } from '@/lib/market/terminalPrefs';
import type { GridCount } from '@/lib/market/terminalPrefs';
import type { ExchangeId } from '@/lib/market/exchanges';
import { SORT_MODE, sortLabel, sortUnavailable } from '@/lib/settings/settings';
import type { SettingsTab, SortMode, SortPref } from '@/lib/settings/settings';
import { openSettings } from '@/lib/settings/settingsUi';

export const SEG = 'flex shrink-0 gap-0.5 rounded-[10px] border border-solid border-sx-line bg-white/[0.03] p-[3px]';
export const SEG_OPT = `${BTN_RESET} rounded-[7px] py-1 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-sx-up`;
export const SEG_ACTIVE = 'bg-white/[0.08] text-sx-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]';
export const SEG_IDLE = 'text-sx-muted hover:text-sx-text';
export const CONTROL = 'h-[30px] rounded-[10px] border border-solid bg-white/[0.03]';

/* ── Generic segmented radio group (roving tabindex, arrow keys) ── */

interface SegmentedGroupProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  /** Horizontal padding of each option (compact groups use less). */
  padX?: string;
}

export function SegmentedGroup<T extends string>({ label, options, value, onChange, padX = 'px-3' }: SegmentedGroupProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = step === -Infinity ? 0 : step === Infinity ? options.length - 1 : (i + step + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className={SEG} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={`${SEG_OPT} ${padX} ${active ? SEG_ACTIVE : SEG_IDLE}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Generic dropdown select (portal menu: the header row scrolls horizontally) ── */

interface DropdownSelectProps<T> {
  /** Accessible name prefix, e.g. "Range window". */
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => ReactNode;
  icon?: ReactNode;
  /** Extra menu rows after the options (e.g. a settings link). */
  footer?: (close: () => void) => ReactNode;
}

export function DropdownSelect<T extends string | number>({ label, options, value, onChange, render, icon, footer }: DropdownSelectProps<T>) {
  return (
    <Popover
      placement="bottom-start"
      portal
      className="min-w-36"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: ${value}`}
          className={`${BTN_RESET} ${CONTROL} inline-flex items-center gap-1.5 px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-sx-up ${
            open ? 'border-sx-line2 bg-white/[0.07] text-sx-text' : 'border-sx-line text-sx-text hover:border-sx-line2'
          }`}
        >
          {icon}
          {render(value)}
          <ChevronDown size={13} strokeWidth={2.25} className={`text-sx-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <>
          {options.map((o) => <MenuOption key={String(o)} checked={o === value} onClick={() => { onChange(o); close(); }}>{render(o)}</MenuOption>)}
          {footer?.(close)}
        </>
      )}
    </Popover>
  );
}

function MenuOption({ checked, onClick, children, disabled }: { checked: boolean; onClick: () => void; children: ReactNode; disabled?: string | null }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      title={disabled ?? undefined}
      onClick={disabled ? undefined : onClick}
      className={`${BTN_RESET} flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold whitespace-nowrap tabular-nums ${
        disabled ? 'cursor-not-allowed text-sx-muted/50' : `hover:bg-white/[0.06] ${checked ? 'text-sx-text' : 'text-sx-muted'}`
      }`}
    >
      <span className="w-3.5">{checked && <Check size={13} strokeWidth={2.5} className="text-sx-up" aria-hidden="true" />}</span>
      {children}
    </button>
  );
}

/** Menu footer row that opens Settings on `tab`. */
function SettingsLink({ tab, label, close }: { tab: SettingsTab; label: string; close: () => void }) {
  return (
    <>
      <div className="mx-1 my-1 h-px bg-sx-line" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        data-settings-link={tab}
        onClick={() => { close(); openSettings(tab); }}
        className={`${BTN_RESET} flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-sx-muted hover:bg-white/[0.06] hover:text-sx-text`}
      >
        <Settings size={13} strokeWidth={2} aria-hidden="true" />{label}
      </button>
    </>
  );
}

const ACTION = `${BTN_RESET} ${CONTROL} grid w-[30px] shrink-0 place-items-center border-sx-line text-sx-muted transition-colors focus-visible:outline-2 focus-visible:outline-sx-up`;


/** Right-hand action group of the Market Map controls: ticker search, filters, settings. */
export function MarketMapActions({ onSearch, onFilters, activeFilter }: { onSearch: () => void; onFilters: () => void; activeFilter: string | null }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pl-2" role="group" aria-label="Market Map actions">
      <button type="button" onClick={onSearch} aria-label="Search tickers" title="Search tickers (Ctrl/⌘ K)" aria-keyshortcuts="Control+K Meta+K" className={`${ACTION} cursor-pointer hover:border-sx-line2 hover:bg-white/[0.07] hover:text-sx-text`}>
        <Search size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onFilters}
        aria-label={activeFilter ? `Filters (active: ${activeFilter})` : 'Filters'}
        title={activeFilter ? `Filter “${activeFilter}” is on` : 'Create and manage Market Map filters'}
        className={`${BTN_RESET} ${CONTROL} inline-flex shrink-0 cursor-pointer items-center gap-1.5 px-2 text-xs font-semibold transition-colors hover:bg-white/[0.07] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up ${
          activeFilter ? 'border-sx-up/40 bg-sx-up/10 text-sx-up' : 'border-sx-line text-sx-muted hover:border-sx-line2'
        }`}
      >
        <FunnelPlus size={14} strokeWidth={2} aria-hidden="true" />
        {activeFilter && <span className="max-w-28 truncate">{activeFilter}</span>}
      </button>
      <button type="button" onClick={() => openSettings('sorting')} aria-label="Market Map settings" title="Market Map settings" data-settings-link="sorting" className={`${ACTION} cursor-pointer hover:border-sx-line2 hover:bg-white/[0.07] hover:text-sx-text`}>
        <Settings size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── Concrete controls ── */

const MARKET_OPTIONS: ReadonlyArray<{ id: MarketType; label: string }> = [
  { id: 'futures', label: 'Futures' },
  { id: 'spot', label: 'Spot' },
];

/** Futures / Spot, limited to the markets enabled in Settings (hidden when only one is). */
export function MarketTypeToggle({ value, onChange, markets }: { value: MarketType; onChange: (m: MarketType) => void; markets: readonly MarketType[] }) {
  const options = MARKET_OPTIONS.filter((m) => markets.includes(m.id));
  if (options.length < 2) return null;
  return <SegmentedGroup label="Market type" options={options} value={value} onChange={onChange} />;
}

/** Card timeframes enabled in Settings, plus a gear that opens Settings → Timeframe. */
export function TimeframeGroup({ value, onChange, options }: { value: Timeframe; onChange: (tf: Timeframe) => void; options: readonly Timeframe[] }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <SegmentedGroup label="Chart timeframe" options={options.map((tf) => ({ id: tf, label: tf }))} value={value} onChange={onChange} padX="px-1.5" />
      <button type="button" onClick={() => openSettings('timeframe')} aria-label="Timeframe settings" title="Timeframe settings" data-settings-link="timeframe" className={`${ACTION} cursor-pointer hover:border-sx-line2 hover:bg-white/[0.07] hover:text-sx-text`}>
        <Settings size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Market Map sort: the modes enabled in Settings, each with its windows (ones the venue can't compute are disabled). */
export function SortSelect({ value, onChange, modes, venue }: { value: SortPref; onChange: (s: SortPref) => void; modes: readonly SortMode[]; venue: ExchangeId }) {
  const label = sortLabel(value);
  return (
    <div className="flex shrink-0 items-center">
      <Popover
        placement="bottom-start"
        portal
        className="sx-scroll max-h-[70vh] min-w-44 overflow-y-auto"
        trigger={(open, toggle) => (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Range window: ${label}`}
            className={`${BTN_RESET} ${CONTROL} inline-flex items-center gap-1.5 px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-sx-up ${
              open ? 'border-sx-line2 bg-white/[0.07] text-sx-text' : 'border-sx-line text-sx-text hover:border-sx-line2'
            }`}
          >
            {label}
            <ChevronDown size={13} strokeWidth={2.25} className={`text-sx-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      >
        {(close) => (
          <>
            {modes.map((mode, i) => {
              const def = SORT_MODE[mode];
              // Availability is per mode (trade counts, OI history), so the first window decides.
              const why = def.windows[0] ? sortUnavailable({ mode, window: def.windows[0].id }, venue) : null;
              return (
                <div key={mode} role="group" aria-label={def.title} className={i ? 'mt-1 border-0 border-t border-solid border-sx-line pt-1' : ''}>
                  {modes.length > 1 && (
                    <div className="px-2.5 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-sx-muted" title={why ?? undefined}>
                      {def.title}{why && <span className="normal-case tracking-normal"> · n/a here</span>}
                    </div>
                  )}
                  {def.windows.map((w) => {
                    const next: SortPref = { mode, window: w.id };
                    const checked = value.mode === mode && value.window === w.id;
                    return <MenuOption key={w.id} checked={checked} disabled={why} onClick={() => { onChange(next); close(); }}>{sortLabel(next)}</MenuOption>;
                  })}
                </div>
              );
            })}
            <SettingsLink tab="sorting" label="Sorting settings…" close={close} />
          </>
        )}
      </Popover>
    </div>
  );
}

/** Grid layouts enabled in Settings → Tops. */
export function GridSelect({ value, onChange, options }: { value: GridCount; onChange: (g: GridCount) => void; options: readonly GridCount[] }) {
  return (
    <div className="flex shrink-0 items-center">
      <DropdownSelect
        label="Grid layout"
        options={options}
        value={value}
        onChange={onChange}
        render={(c) => gridLabel(gridLayout(c))}
        icon={<LayoutGrid size={13} strokeWidth={2} className="text-sx-muted" aria-hidden="true" />}
        footer={(close) => <SettingsLink tab="tops" label="Layout settings…" close={close} />}
      />
    </div>
  );
}

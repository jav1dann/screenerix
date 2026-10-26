'use client';

import { Camera, ChevronUp, Maximize2, Minimize2, Settings, SquareFunction, X } from 'lucide-react';
import { useColorRules } from '@/hooks/useTerminal';
import type { ChartPrefs } from '@/lib/drawings/chartPrefs';
import { ruleColor } from '@/lib/screener/colorRules';
import { COLORS } from '@/lib/theme';
import { fmtDateTime, fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import type { ChartTimeframe, ExchangeId, RawCandle } from '@/lib/market/exchanges';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import type { ConnState } from '@/lib/market/types';
import { BTN_RESET } from '../styles';
import { SettingsMenu } from './ChartMenus';
import Popover from '@/components/shared/Popover';

export const CHART_TIMEFRAMES: readonly ChartTimeframe[] = ['1s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

interface ExpandedHeaderProps {
  /** e.g. "CFXUSDT.P". */
  displayTicker: string;
  exchangeName: string;
  exchange: ExchangeId;
  marketLabel: string;
  conn: ConnState;
  tf: ChartTimeframe;
  onTf: (tf: ChartTimeframe) => void;
  /** Hovered bar, or the live bar when not hovering. */
  bar: RawCandle | null;
  hovering: boolean;
  change24h: number | null;
  /** Live funding rate (fraction), shown next to the 24h change; undefined hides it (spot). */
  funding?: number | null;
  prefs: ChartPrefs;
  updatePrefs: (patch: Partial<ChartPrefs>) => void;
  /** Opens the Indicator modal. */
  onIndicators: () => void;
  onSnapshot: () => void;
  /** OHLCV / 24h stats line folded away. */
  statsCollapsed: boolean;
  onToggleStats: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  /** Modal only: shows the close button. */
  onClose?: () => void;
}

const HDR_BTN = `${BTN_RESET} inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-sx-muted transition-colors hover:bg-white/[0.06] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`;
const ICON = `${BTN_RESET} grid h-8 w-8 place-items-center rounded-lg text-sx-muted transition-colors hover:bg-white/[0.06] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`;
const DOT: Partial<Record<ConnState, string>> = { live: 'bg-sx-up', error: 'bg-sx-down', connecting: 'bg-sx-alert', reconnecting: 'bg-sx-alert' };

function Ohlc({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <span className="whitespace-nowrap"><span className="text-sx-muted">{label}</span> <span className={`tabular-nums ${tone}`}>{value}</span></span>;
}

export default function ExpandedHeader(p: ExpandedHeaderProps) {
  const rules = useColorRules();
  const up = p.bar ? p.bar.c >= p.bar.o : true;
  const tone = up ? 'text-sx-up' : 'text-sx-down';
  const barChange = p.bar && p.bar.o ? p.bar.c / p.bar.o - 1 : null;
  const subMinute = p.tf === '1s' || p.tf === '30s';

  return (
    <div className="flex flex-col border-0 border-b border-solid border-sx-line">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[p.conn] ?? 'bg-sx-line2'}`} title={p.conn} />
          <h2 className="m-0 truncate text-[15px] font-extrabold tracking-tight">{p.displayTicker}</h2>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-solid border-sx-line2 bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-semibold text-sx-muted" data-venue-badge>
            <ExchangeIcon id={p.exchange} size={13} />{p.exchangeName} · {p.marketLabel}
          </span>
        </div>

        <div className="order-3 flex w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <div className="flex gap-0.5 overflow-x-auto rounded-lg border border-solid border-sx-line bg-white/[0.02] p-0.5 [scrollbar-width:none]" role="radiogroup" aria-label="Timeframe">
            {CHART_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                role="radio"
                aria-checked={p.tf === tf}
                onClick={() => p.onTf(tf)}
                className={`${BTN_RESET} shrink-0 rounded-md px-2 py-1 text-xs font-semibold tabular-nums transition-colors ${
                  p.tf === tf ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:text-sx-text'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" className={HDR_BTN} onClick={p.onIndicators} aria-haspopup="dialog" title="Indicators">
            <SquareFunction size={15} aria-hidden="true" /><span className="hidden md:inline">Indicators</span>
          </button>
          <Popover
            trigger={(open, toggle) => (
              <button type="button" className={`${HDR_BTN} ${open ? 'bg-white/[0.06] text-sx-text' : ''}`} onClick={toggle} aria-expanded={open}>
                <Settings size={15} aria-hidden="true" /><span className="hidden md:inline">Settings</span>
              </button>
            )}
          >
            {(close) => <SettingsMenu prefs={p.prefs} update={p.updatePrefs} onClose={close} />}
          </Popover>
          <span className="mx-1 h-5 w-px bg-sx-line" aria-hidden="true" />
          <button
            type="button"
            className={ICON}
            onClick={p.onToggleStats}
            aria-expanded={!p.statsCollapsed}
            aria-label={p.statsCollapsed ? 'Show price details' : 'Hide price details'}
            title={p.statsCollapsed ? 'Show details' : 'Hide details'}
          >
            <ChevronUp size={16} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${p.statsCollapsed ? 'rotate-180' : ''}`} />
          </button>
          <button type="button" className={ICON} onClick={p.onSnapshot} title="Download snapshot (PNG)" aria-label="Download snapshot">
            <Camera size={16} aria-hidden="true" />
          </button>
          <button type="button" className={ICON} onClick={p.onFullscreen} title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {p.fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
          {p.onClose && (
            <button type="button" className={`${ICON} hover:text-sx-down`} onClick={p.onClose} title="Close (Esc)" aria-label="Close terminal">
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Live OHLCV line — hovered bar, else the forming bar. Collapsible to give the chart more height. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${p.statsCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}
        aria-hidden={p.statsCollapsed}
      >
      <div className="flex min-h-0 flex-wrap items-center gap-x-3 gap-y-0.5 overflow-hidden px-3 text-xs" aria-live="off">
      <div className="flex min-h-7 w-full flex-wrap items-center gap-x-3 gap-y-0.5 pb-1.5">
        {p.bar ? (
          <>
            <span className="text-sx-muted">{p.hovering ? fmtDateTime(p.bar.t) + (subMinute ? `:${String(new Date(p.bar.t).getSeconds()).padStart(2, '0')}` : '') : 'Live'}</span>
            <Ohlc label="O" value={fmtPrice(p.bar.o)} tone={tone} />
            <Ohlc label="H" value={fmtPrice(p.bar.h)} tone={tone} />
            <Ohlc label="L" value={fmtPrice(p.bar.l)} tone={tone} />
            <Ohlc label="C" value={fmtPrice(p.bar.c)} tone={tone} />
            <Ohlc label="Vol" value={fmtUsd(p.bar.v * p.bar.c)} tone="text-sx-text" />
            {barChange !== null && <span className={`tabular-nums ${tone}`}>{fmtPct(barChange)}</span>}
          </>
        ) : (
          <span className="text-sx-muted">Waiting for data…</span>
        )}
        {p.funding !== undefined && (
          <span className="ml-auto rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sx-muted" title="Current funding rate" data-funding>
            Fund.{' '}
            <span style={{ color: p.funding === null ? undefined : ruleColor(rules, 'funding', p.funding * 100) ?? (p.funding >= 0 ? COLORS.up : COLORS.down) }}>
              {p.funding === null ? '—' : fmtPct(p.funding, 4)}
            </span>
          </span>
        )}
        {p.change24h !== null && (
          <span className={`${p.funding !== undefined ? '' : 'ml-auto '}rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${p.change24h >= 0 ? 'bg-sx-up/15 text-sx-up' : 'bg-sx-down/15 text-sx-down'}`}>
            24h {fmtPct(p.change24h)}
          </span>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}

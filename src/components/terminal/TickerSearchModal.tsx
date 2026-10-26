'use client';

/**
 * Ticker search: find any coin across the selected exchanges. Matches are ranked
 * exact symbol → prefix → contains, ties broken by 24h volume. ↑/↓ move, Enter
 * opens, Esc closes.
 *
 * Spread (÷) mode picks two coins on one venue and opens their ratio chart.
 * Settings: exact matches only, and which exchanges to search.
 */
import { useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Divide, Search, Settings, X } from 'lucide-react';
import { BTN_RESET } from '@/components/chart/styles';
import type { MarketType } from '@/lib/alerts/alertStore';
import { fmtPct, fmtPrice, fmtUsd, tone } from '@/lib/format';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import { normalizeQuery, rankBy } from '@/lib/market/searchRank';
import { SEARCH_VENUES, searchPrefs } from '@/lib/market/searchPrefs';
import { toRow } from '@/lib/market/simulation';
import type { Asset, ExchangeId } from '@/lib/market/types';
import { getDirectory } from '@/lib/market/venueDirectory';
import type { DirectoryEntry } from '@/lib/market/venueDirectory';

const MAX_RESULTS = 50;

export interface SearchPick { symbol: string; exchange: ExchangeId }

interface TickerSearchModalProps {
  /** Every coin on the primary venue, most traded first (live). */
  market: Asset[];
  primary: ExchangeId;
  marketType: MarketType;
  onPick: (pick: SearchPick) => void;
  /** Spread mode: open the A ÷ B chart. */
  onPickSpread: (spread: { a: string; b: string; exchange: ExchangeId }) => void;
  onClose: () => void;
}

interface Hit extends SearchPick {
  price: number;
  change: number | null;
  /** Window of `change`: the live venue reports 5m, snapshots 24h. */
  changeLabel: '5m' | '24h';
  volume: number;
}

type DirState = DirectoryEntry[] | 'loading' | 'error';

const venueMarket = (id: ExchangeId): MarketType => (ADAPTERS[id].market === 'perp' ? 'futures' : 'spot');

export default function TickerSearchModal({ market, primary, marketType, onPick, onPickSpread, onClose }: TickerSearchModalProps) {
  const prefs = useSyncExternalStore(searchPrefs.subscribe, searchPrefs.getSnapshot, searchPrefs.getServerSnapshot);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [view, setView] = useState<'results' | 'settings'>('results');
  const [spread, setSpread] = useState(false);
  const [numerator, setNumerator] = useState<SearchPick | null>(null);
  const [dirs, setDirs] = useState<Partial<Record<ExchangeId, DirState>>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  // Venues searched: the checked ones that trade this market type, the primary always.
  // A spread's denominator must come from the numerator's venue.
  const venues: ExchangeId[] = numerator
    ? [numerator.exchange]
    : [primary, ...prefs.venues.filter((id) => id !== primary && venueMarket(id) === marketType)];
  const remote = venues.filter((id) => id !== primary);
  const remoteKey = remote.join(',');

  useEffect(() => {
    let alive = true;
    for (const id of remoteKey ? (remoteKey.split(',') as ExchangeId[]) : []) {
      getDirectory(id).then(
        (list) => { if (alive) setDirs((d) => ({ ...d, [id]: list })); },
        () => { if (alive) setDirs((d) => ({ ...d, [id]: 'error' })); },
      );
    }
    return () => { alive = false; };
  }, [remoteKey]);

  const live: Hit[] = market.map((a) => {
    const r = toRow(a);
    return { symbol: a.symbol, exchange: primary, price: r.price, change: r.c5, changeLabel: '5m', volume: a.volume };
  });
  const q = normalizeQuery(query);
  const pool: Hit[] = venues.includes(primary) ? [...live] : [];
  for (const id of remote) {
    const d = dirs[id];
    if (Array.isArray(d)) for (const e of d) pool.push({ symbol: e.symbol, exchange: id, price: e.price, change: e.change24h, changeLabel: '24h', volume: e.volume });
  }
  pool.sort((x, y) => y.volume - x.volume);
  const ranked = q
    ? rankBy(pool, (h) => h.symbol, q, { exactOnly: prefs.exactOnly })
    : pool.filter((h) => !numerator || h.symbol !== numerator.symbol);
  const candidates = numerator ? ranked.filter((h) => h.symbol !== numerator.symbol) : ranked;
  const matches = candidates.slice(0, MAX_RESULTS);
  const total = candidates.length;
  const active = Math.min(highlight, Math.max(0, matches.length - 1));
  const loading = remote.filter((id) => dirs[id] === undefined || dirs[id] === 'loading');
  const failed = remote.filter((id) => dirs[id] === 'error');
  const multi = venues.length > 1;

  useEffect(() => { if (view === 'results') inputRef.current?.focus(); }, [view, spread]);

  // Keep the highlighted row in view while arrowing through results.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Esc steps back (settings → results, denominator → numerator), then closes the search only.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (view === 'settings') setView('results');
    else if (numerator) setNumerator(null);
    else onClose();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const pick = (h: Hit) => {
    if (!spread) { onPick({ symbol: h.symbol, exchange: h.exchange }); return; }
    if (!numerator) { setNumerator({ symbol: h.symbol, exchange: h.exchange }); setQuery(''); setHighlight(0); return; }
    onPickSpread({ a: numerator.symbol, b: h.symbol, exchange: numerator.exchange });
  };

  const toggleSpread = () => {
    setSpread((s) => !s);
    setNumerator(null);
    setHighlight(0);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(Math.min(active + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Backspace' && !query && numerator) { e.preventDefault(); setNumerator(null); }
  };

  const toggleVenue = (id: ExchangeId) => {
    const has = prefs.venues.includes(id);
    searchPrefs.update({ venues: has ? prefs.venues.filter((v) => v !== id) : [...prefs.venues, id] });
  };

  const placeholder = spread
    ? numerator ? `Pick the coin to divide ${numerator.symbol} by…` : 'Spread: pick the first coin…'
    : `Search ${multi ? `${venues.length} exchanges` : `${market.length} ${ADAPTERS[primary].name} coins`}…`;

  const iconBtn = (on: boolean) => `${BTN_RESET} grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-sx-up ${
    on ? 'bg-sx-up/15 text-sx-up' : 'text-sx-muted hover:bg-white/[0.06] hover:text-sx-text'
  }`;

  return createPortal(
    <div className="fixed inset-0 z-[115] flex justify-center p-4 pt-[12vh] text-sx-text [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label="Close search" onClick={onClose} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tickers"
        className="relative flex max-h-[min(600px,78vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-3 py-2.5">
          {view === 'settings' ? (
            <>
              <button type="button" onClick={() => setView('results')} aria-label="Back to results" className={iconBtn(false)}>
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
              <span className="flex-1 text-sm font-semibold">Search settings</span>
            </>
          ) : (
            <>
              <button type="button" onClick={toggleSpread} aria-pressed={spread} aria-label="Spread (A ÷ B)" title="Spread: chart one coin divided by another" className={iconBtn(spread)}>
                <Divide size={16} aria-hidden="true" />
              </button>
              <Search size={15} className="shrink-0 text-sx-muted" aria-hidden="true" />
              {numerator && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sx-up/15 px-2 py-0.5 text-xs font-bold text-sx-up">
                  {numerator.symbol} ÷
                  <button type="button" onClick={() => setNumerator(null)} aria-label={`Remove ${numerator.symbol}`} className={`${BTN_RESET} grid h-4 w-4 place-items-center rounded text-sx-up hover:bg-sx-up/20`}>
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                onKeyDown={onInputKey}
                placeholder={placeholder}
                aria-label="Ticker"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${ids}-list`}
                aria-activedescendant={matches[active] ? `${ids}-opt-${active}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 font-[inherit] text-[15px] text-sx-text outline-none placeholder:text-[#5F626C]"
              />
            </>
          )}
          {view === 'results' && (
            <button type="button" onClick={() => setView('settings')} aria-label="Search settings" title="Search settings" className={iconBtn(prefs.exactOnly)}>
              <Settings size={15} aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className={`${iconBtn(false)} sm:hidden`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {view === 'settings' ? (
          <div className="sx-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2">
              <input type="checkbox" checked={prefs.exactOnly} onChange={(e) => searchPrefs.update({ exactOnly: e.target.checked })} className="h-4 w-4 cursor-pointer accent-[#30A46C]" />
              <span className="flex flex-col">
                <span className="font-semibold">Show exact matches only</span>
                <span className="text-xs text-sx-muted">“BTC” finds BTC, not BTCDOM</span>
              </span>
            </label>
            <div className="mt-3 border-0 border-t border-solid border-sx-line pt-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-sx-muted">Search on exchanges</div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3" role="group" aria-label="Search on exchanges">
                {SEARCH_VENUES.map((v) => {
                  const soon = v.id === null;
                  const wrongMarket = v.id !== null && venueMarket(v.id) !== marketType;
                  const isPrimary = v.id === primary;
                  const disabled = soon || wrongMarket || isPrimary;
                  const checked = v.id !== null && !wrongMarket && (isPrimary || prefs.venues.includes(v.id));
                  const note = soon ? 'Soon' : wrongMarket ? (marketType === 'futures' ? 'Spot' : 'Futures') : isPrimary ? 'Current' : null;
                  const title = soon ? `${v.name} — coming soon` : wrongMarket ? `${v.name} only lists ${venueMarket(v.id!)} here — switch the market type` : isPrimary ? `${v.name} is the current exchange (always searched)` : undefined;
                  return (
                    <label key={v.name} title={title} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-white/[0.04]'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => { if (v.id) toggleVenue(v.id); }}
                        className="h-4 w-4 cursor-pointer accent-[#30A46C] disabled:cursor-default"
                      />
                      <ExchangeIcon id={v.id} name={v.name} size={14} style={soon ? { opacity: 0.5 } : undefined} /><span className={disabled && !isPrimary ? 'text-sx-muted' : ''}>{v.name}</span>
                      {note && <span className={`ml-auto rounded px-1.5 text-[10px] font-semibold ${soon ? 'bg-white/[0.06] text-sx-muted' : 'text-sx-muted'}`}>{note}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex px-4 pb-1 pt-2 text-[10px] uppercase tracking-wide text-sx-muted">
              <span className="flex-1">
                {spread ? (numerator ? `${numerator.symbol} ÷ … on ${ADAPTERS[numerator.exchange].name}` : 'Spread · first coin') : q ? `${total} match${total === 1 ? '' : 'es'}` : 'Most traded'}
                {prefs.exactOnly && q ? ' · exact' : ''}
              </span>
              <span className="w-24 text-right">Price</span>
              <span className="w-20 text-right">Change</span>
              <span className="w-20 text-right">Vol 24h</span>
            </div>

            <div ref={listRef} id={`${ids}-list`} role="listbox" aria-label="Matching tickers" className="sx-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {matches.map((h, i) => (
                <div
                  key={`${h.exchange}:${h.symbol}`}
                  id={`${ids}-opt-${i}`}
                  data-index={i}
                  data-exchange={h.exchange}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                  onClick={() => pick(h)}
                  className={`flex cursor-pointer items-center rounded-lg px-2 py-2 text-[13px] ${i === active ? 'bg-white/[0.07]' : ''}`}
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="truncate font-bold">{h.symbol}</span>
                    <span className="text-[11px] text-sx-muted">/{ADAPTERS[h.exchange].quote}</span>
                    {multi && <span className="ml-1 inline-flex shrink-0 items-center gap-1 self-center rounded bg-white/[0.06] px-1.5 py-px text-[10px] font-semibold text-sx-muted" data-hit-venue><ExchangeIcon id={h.exchange} size={11} />{ADAPTERS[h.exchange].name}</span>}
                  </span>
                  <span className="w-24 text-right tabular-nums">{fmtPrice(h.price)}</span>
                  <span className="w-20 text-right tabular-nums" title={`${h.changeLabel} change`} style={h.change === null ? undefined : { color: tone(h.change) }}>
                    {h.change === null ? '—' : fmtPct(h.change)}
                    <span className="ml-0.5 text-[9px] text-sx-muted">{h.changeLabel}</span>
                  </span>
                  <span className="w-20 text-right tabular-nums text-sx-muted">{fmtUsd(h.volume)}</span>
                </div>
              ))}
              {matches.length === 0 && (
                <div className="px-2 py-8 text-center text-sm text-sx-muted">
                  {!market.length && !pool.length ? 'Waiting for market data…'
                    : `No ${prefs.exactOnly ? 'exact ' : ''}match for “${query.trim()}”${multi ? ` on ${venues.length} exchanges` : ''}.`}
                </div>
              )}
              {total > matches.length && (
                <div className="px-2 pt-2 text-center text-[11px] text-sx-muted">Showing {matches.length} of {total} — keep typing to narrow it down.</div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center gap-3 border-0 border-t border-solid border-sx-line px-4 py-2 text-[11px] text-sx-muted">
          <span>↑ ↓ to navigate</span>
          <span>{spread ? (numerator ? 'Enter to open the spread' : 'Enter to pick') : 'Enter to open chart'}</span>
          <span className="ml-auto flex items-center gap-1 truncate">
            {loading.length > 0 ? `Loading ${loading.map((id) => ADAPTERS[id].name).join(', ')}…`
              : failed.length > 0 ? `${failed.map((id) => ADAPTERS[id].name).join(', ')} unavailable`
              : <><Check size={11} aria-hidden="true" />{venues.map((id) => ADAPTERS[id].name).join(' · ')}</>}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

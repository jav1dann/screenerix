'use client';

/**
 * Densities: a dense grid of cards, one per coin × venue × market with large
 * resting orders. The server's background scanner keeps every venue's tracked
 * densities (with real lifetimes) in its cache; this view filters and sorts them
 * locally, and patches near-price levels from the live WebSocket book of the
 * terminal's primary venue. Controls live in the header row (DensityControls);
 * the Filters / Coloring modals open from there.
 */
import { memo, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import { useDensityColoring, useDensityFilters, useDensityPrefs, useNow, useServerDensities } from '@/hooks/useDensities';
import { filterDensities, fmtLifetime, isStablecoin, patchWithLive, sortCards, tierColor } from '@/lib/densities/detect';
import type { DensityCard as Card, TrackedDensity } from '@/lib/densities/detect';
import { densityColoring, densityFilters, densityPrefs, stepOf } from '@/lib/densities/settings';
import type { DensityColoring, DensityFilters } from '@/lib/densities/settings';
import { supportsDensity } from '@/lib/densities/types';
import type { DensityMarket, DepthLevel } from '@/lib/densities/types';
import { fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import { DENSITY_FLOOR, DENSITY_RANGE } from '@/lib/scan/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import DensityColoringModal from '../overlays/DensityColoringModal';
import DensityFiltersModal from '../overlays/DensityFiltersModal';

/** Cards rendered at once (the rest are counted). */
const MAX_CARDS = 240;
/** Live near-price patch cadence. */
const LIVE_MS = 1_000;
const SHORT: Record<ExchangeId, string> = { binance: 'BN', bybit: 'BY', okx: 'OKX', bitget: 'BG', gate: 'GT', coinbase: 'CB' };

export type DensityModalKind = 'filters' | 'coloring' | null;

interface DensitiesProps {
  /** The terminal's primary venue: its streamed books patch near levels live. */
  primary: ExchangeId;
  getLevels: (symbol: string) => { bids: DepthLevel[]; asks: DepthLevel[] } | null;
  modal: DensityModalKind;
  onModal: (m: DensityModalKind) => void;
  /** Open a coin's chart (futures venues and Coinbase spot). */
  onOpenChart: (symbol: string, venue: ExchangeId) => void;
}

const hasChart = (venue: ExchangeId, market: DensityMarket) => (market === 'futures' ? ADAPTERS[venue].market === 'perp' : venue === 'coinbase');

export default function Densities({ primary, getLevels, modal, onModal, onOpenChart }: DensitiesProps) {
  const [prefs] = useDensityPrefs();
  const filters = useDensityFilters();
  const coloring = useDensityColoring();
  const now = useNow(1_000);

  const pairs = useMemo(
    () => prefs.venues.flatMap((venue) => prefs.markets.filter((m) => supportsDensity(venue, m)).map((market) => ({ venue, market }))),
    [prefs.venues, prefs.markets],
  );
  const step = stepOf(filters);
  // The server trims to what the filters can show: the smallest size any coin may use, within the max distance.
  const serverMin = Math.min(filters.minSize, ...filters.individual.map((x) => x.minSize));
  const feed = useServerDensities(pairs, step, serverMin, filters.maxDistance);
  const liveMarket: DensityMarket = ADAPTERS[primary].market === 'perp' ? 'futures' : 'spot';

  // Near-price levels of the primary venue follow its live WebSocket book (re-detected every second).
  const [livePatch, setLivePatch] = useState<ReadonlyMap<string, TrackedDensity[]>>(new Map());
  const patchLive = useEffectEvent(() => {
    setLivePatch((prev) => {
      const next = new Map<string, TrackedDensity[]>();
      const at = Date.now();
      for (const c of feed.cards) {
        if (c.venue !== primary || c.market !== liveMarket) continue;
        const levels = getLevels(c.symbol);
        if (levels) next.set(c.key, patchWithLive(c.densities, prev.get(c.key) ?? [], levels, { stepPct: step, maxDistance: DENSITY_RANGE, floor: DENSITY_FLOOR }, at));
      }
      return next;
    });
  });
  useEffect(() => {
    const t = setInterval(patchLive, LIVE_MS);
    return () => clearInterval(t);
  }, []);

  // The user's filters over the server's cards (all local — edits apply instantly).
  const black = new Set(filters.blacklist);
  const cards: Card[] = feed.cards
    .filter((c) => c.volume24h >= filters.minVolume24h && !black.has(c.symbol) && !(filters.excludeStable && isStablecoin(c.symbol)) && !(filters.excludeLeveraged && c.lev))
    .map((c) => {
      const live = livePatch.get(c.key);
      return {
        key: c.key, venue: c.venue, market: c.market, symbol: c.symbol, last: c.last, change24h: c.change24h, volume24h: c.volume24h,
        densities: filterDensities(live ?? c.densities, c.medians, c.symbol, filters), updatedAt: c.updatedAt, live: Boolean(live),
      };
    });
  const sorted = sortCards(cards, filters, prefs.sort, now);
  const shown = sorted.slice(0, MAX_CARDS);
  const loading = feed.state === 'loading' || feed.coverage.some((p) => p.total === 0 || p.scanned < p.total);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sx-muted" aria-live="polite" data-density-progress>
        <span className="text-sm font-semibold text-sx-text">Densities</span>
        <span className="tabular-nums">{sorted.length} coin{sorted.length === 1 ? '' : 's'} · ≥ {fmtUsd(filters.minSize)} within {filters.maxDistance}%</span>
        {feed.coverage.map((p) => (
          <span key={`${p.venue}|${p.market}`} className="tabular-nums" title={p.error}>
            · {ADAPTERS[p.venue].name} {p.market === 'futures' ? 'Futures' : 'Spot'}{' '}
            {p.error ? <span className="text-sx-down">unavailable</span> : `${p.scanned} / ${p.total || '…'}`}
          </span>
        ))}
      </div>

      {pairs.length === 0 && (
        <div className="sx-glass sx-skeleton" style={{ height: 160 }}>No order-book source for this selection — pick another exchange or market.</div>
      )}
      {pairs.length > 0 && shown.length === 0 && (
        <div className="sx-glass sx-skeleton" style={{ height: 160 }}>
          {loading ? 'Scanning order books for densities…' : `No densities ≥ ${fmtUsd(filters.minSize)} within ${filters.maxDistance}% right now.`}
        </div>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }} data-density-grid>
        {shown.map(({ card, densities }) => (
          <DensityCardView key={card.key} card={card} densities={densities} coloring={coloring} now={now} onOpen={hasChart(card.venue, card.market) ? () => onOpenChart(card.symbol, card.venue) : undefined} />
        ))}
      </div>
      {sorted.length > shown.length && <div className="text-center text-xs text-sx-muted">+{sorted.length - shown.length} more — narrow the filters to see them.</div>}

      {modal === 'filters' && (
        <DensityFiltersModal
          filters={filters}
          markets={prefs.markets}
          symbols={[...new Set(feed.cards.map((c) => c.symbol))].sort()}
          onApply={(f: DensityFilters, markets) => { densityFilters.set(f); densityPrefs.update({ markets }); onModal(null); }}
          onClose={() => onModal(null)}
        />
      )}
      {modal === 'coloring' && (
        <DensityColoringModal coloring={coloring} onSave={(c: DensityColoring) => { densityColoring.set(c); onModal(null); }} onClose={() => onModal(null)} />
      )}
    </div>
  );
}

const DensityCardView = memo(function DensityCardView({ card, densities, coloring, now, onOpen }: { card: Card; densities: TrackedDensity[]; coloring: DensityColoring; now: number; onOpen?: () => void }) {
  const max = Math.max(...densities.map((d) => d.notional));
  const change = card.change24h;
  return (
    <article
      className={`sx-glass flex flex-col gap-1 p-2.5 text-[11px] ${onOpen ? 'cursor-pointer transition-colors hover:border-sx-line2' : ''}`}
      style={{ color: coloring.font }}
      data-card={card.key}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen(); } : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={`${card.symbol} densities on ${ADAPTERS[card.venue].name} ${card.market}`}
    >
      <header className="mb-0.5 flex items-center gap-1.5">
        <span className="truncate text-[13px] font-extrabold" data-symbol>{card.symbol}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-white/[0.06] px-1 text-[9px] font-bold text-sx-muted" data-venue title={`${ADAPTERS[card.venue].name} ${card.market}`}><ExchangeIcon id={card.venue} size={10} />{SHORT[card.venue]}·{card.market === 'futures' ? 'F' : 'S'}</span>
        {card.live && <Radio size={11} className="shrink-0 text-sx-up" aria-label="Live near-price levels" />}
        <span className="ml-auto tabular-nums font-semibold">{fmtPrice(card.last)}</span>
        {change !== null && <span className="tabular-nums" style={{ color: change >= 0 ? coloring.bids : coloring.asks }}>{fmtPct(change)}</span>}
      </header>
      {densities.map((d) => {
        const color = tierColor(d, coloring);
        const signed = d.side === 'ask' ? d.distance : -d.distance;
        return (
          <div key={d.id} className="relative grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded px-1.5 py-[3px] tabular-nums" data-density={d.side} data-notional={Math.round(d.notional)} data-distance={d.distance.toFixed(6)} data-age={now - d.firstSeen}>
            <span className="absolute inset-y-0 left-0 rounded opacity-25" style={{ width: `${Math.max(4, (d.notional / max) * 100)}%`, background: color }} aria-hidden="true" />
            <span className="relative" style={{ color: d.side === 'ask' ? coloring.asks : coloring.bids }}>{fmtPrice(d.price)}</span>
            <span className="relative font-bold" style={{ color }}>{fmtUsd(d.notional)}</span>
            <span className="relative w-12 text-right opacity-75">{signed >= 0 ? '+' : '−'}{(Math.abs(signed) * 100).toFixed(2)}%</span>
            <span className="relative w-12 text-right opacity-60" title="Lifetime">{fmtLifetime(now - d.firstSeen)}</span>
          </div>
        );
      })}
    </article>
  );
});

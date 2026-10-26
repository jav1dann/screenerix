'use client';

/**
 * Densities control row: exchange checklist, Futures / Spot toggles, Filters,
 * Coloring and Sorting. Reads and writes the persisted density settings.
 */
import { ArrowDownUp, Funnel, Palette } from 'lucide-react';
import { BTN_RESET } from '@/components/chart/styles';
import { useDensityFilters, useDensityPrefs } from '@/hooks/useDensities';
import { activeFilterCount, DENSITY_SORTS, DENSITY_VENUES, SORT_LABEL } from '@/lib/densities/settings';
import { supportsDensity } from '@/lib/densities/types';
import type { DensityMarket } from '@/lib/densities/types';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import type { ExchangeId } from '@/lib/market/exchanges';
import { CONTROL, DropdownSelect, SEG, SEG_ACTIVE, SEG_IDLE, SEG_OPT } from './MarketControls';

const DIVIDER = <span className="mx-1 h-5 w-px shrink-0 bg-sx-line" aria-hidden="true" />;
const ACTION = `${BTN_RESET} ${CONTROL} inline-flex shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-semibold transition-colors hover:bg-white/[0.07] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`;
const MARKETS: ReadonlyArray<{ id: DensityMarket; label: string }> = [{ id: 'futures', label: 'Futures' }, { id: 'spot', label: 'Spot' }];

export default function DensityControls({ onFilters, onColoring }: { onFilters: () => void; onColoring: () => void }) {
  const [prefs, update] = useDensityPrefs();
  const filters = useDensityFilters();
  const count = activeFilterCount(filters);
  const toggleVenue = (id: ExchangeId) => {
    const next = prefs.venues.includes(id) ? prefs.venues.filter((v) => v !== id) : [...prefs.venues, id];
    if (next.length) update({ venues: next });
  };
  const toggleMarket = (m: DensityMarket) => {
    const next = prefs.markets.includes(m) ? prefs.markets.filter((x) => x !== m) : [...prefs.markets, m];
    if (next.length) update({ markets: MARKETS.map((x) => x.id).filter((x) => next.includes(x)) });
  };

  return (
    <>
      <div role="group" aria-label="Exchanges" className={SEG}>
        {DENSITY_VENUES.map(({ id, name }) => {
          if (!id) {
            return (
              <button key={name} type="button" disabled aria-label={`${name} (coming soon)`} title={`${name} — coming soon`} className={`${SEG_OPT} inline-flex items-center gap-1.5 px-2.5 text-[#55585F]`}>
                <ExchangeIcon name={name} size={13} style={{ opacity: 0.5 }} />{name}<sup className="ml-0.5 text-[9px] font-semibold text-[#6B6E78]">Soon</sup>
              </button>
            );
          }
          const on = prefs.venues.includes(id);
          const usable = prefs.markets.some((m) => supportsDensity(id, m));
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleVenue(id)}
              title={usable ? undefined : `${name} has no ${prefs.markets.join(' / ')} market here`}
              className={`${SEG_OPT} inline-flex items-center gap-1.5 px-2.5 ${on ? SEG_ACTIVE : SEG_IDLE} ${on && !usable ? 'opacity-50' : ''}`}
            >
              <ExchangeIcon id={id} size={13} />{name}
            </button>
          );
        })}
      </div>
      {DIVIDER}
      <div role="group" aria-label="Market types" className={SEG}>
        {MARKETS.map((m) => (
          <button key={m.id} type="button" aria-pressed={prefs.markets.includes(m.id)} onClick={() => toggleMarket(m.id)} className={`${SEG_OPT} px-3 ${prefs.markets.includes(m.id) ? SEG_ACTIVE : SEG_IDLE}`}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2" role="group" aria-label="Densities actions">
        <button type="button" onClick={onFilters} aria-label={count ? `Filters (${count} active)` : 'Filters'}
          className={`${ACTION} ${count ? 'border-sx-up/40 bg-sx-up/10 text-sx-up' : 'border-sx-line text-sx-muted hover:border-sx-line2'}`}>
          <Funnel size={14} strokeWidth={2} aria-hidden="true" />Filters
          {count > 0 && <span className="rounded bg-sx-up/20 px-1 text-[10px] tabular-nums">{count}</span>}
        </button>
        <button type="button" onClick={onColoring} aria-label="Coloring" className={`${ACTION} border-sx-line text-sx-muted hover:border-sx-line2`}>
          <Palette size={14} strokeWidth={2} aria-hidden="true" />Coloring
        </button>
        <DropdownSelect
          label="Sorting"
          options={DENSITY_SORTS}
          value={prefs.sort}
          onChange={(sort) => update({ sort })}
          render={(s) => SORT_LABEL[s]}
          icon={<ArrowDownUp size={13} strokeWidth={2} className="text-sx-muted" aria-hidden="true" />}
        />
      </div>
    </>
  );
}

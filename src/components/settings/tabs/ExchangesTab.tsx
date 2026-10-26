'use client';

import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { CheckRow, Group } from '@/components/shared/form';
import { DropdownSelect } from '@/components/terminal/MarketControls';
import type { MarketType } from '@/lib/alerts/alertStore';
import { EXCHANGE_IDS } from '@/lib/market/exchanges';
import { MARKET_LABEL, marketOf, SETTINGS_VENUES, updateSection } from '@/lib/settings/settings';
import type { Settings } from '@/lib/settings/settings';

const MARKETS: readonly MarketType[] = ['futures', 'spot'];

export default function ExchangesTab({ settings }: { settings: Settings }) {
  const s = settings.exchanges;
  const defaults = ['last' as const, ...EXCHANGE_IDS];
  return (
    <>
      <Group title="Default exchange & market" hint="Where the terminal opens. “Last session” reopens the venue you used last.">
        <div className="max-w-xs">
          <DropdownSelect
            label="Default exchange and market" options={defaults} value={s.defaultVenue}
            onChange={(defaultVenue) => updateSection('exchanges', { defaultVenue })}
            render={(v) => (v === 'last' ? 'Last session' : <ExchangeLabel id={v} size={14} suffix={` · ${MARKET_LABEL[marketOf(v)]}`} />)}
          />
        </div>
      </Group>
      <Group title="Exchanges" hint="Venues offered in the header. ALPHA and SOON venues have no data source yet.">
        <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Exchanges">
          {SETTINGS_VENUES.map(({ id, name, badge }) => {
            const on = id !== null && s.venues.includes(id);
            return (
              <CheckRow
                key={name}
                label={<span className="inline-flex items-center gap-2"><ExchangeIcon id={id} name={name} size={15} style={id === null ? { opacity: 0.5 } : undefined} />{name}</span>}
                badge={badge}
                hint={id ? MARKET_LABEL[marketOf(id)] : undefined}
                disabled={id === null || (on && s.venues.length === 1)}
                checked={on}
                onChange={(v) => { if (id) updateSection('exchanges', { venues: v ? [...s.venues, id] : s.venues.filter((x) => x !== id) }); }}
              />
            );
          })}
        </div>
      </Group>
      <Group title="Markets" hint="Market types offered in the header. At least one stays on.">
        <div className="flex flex-wrap gap-0.5" role="group" aria-label="Markets">
          {MARKETS.map((m) => {
            const on = s.markets.includes(m);
            return (
              <CheckRow
                key={m}
                label={MARKET_LABEL[m]}
                checked={on}
                disabled={on && s.markets.length === 1}
                onChange={(v) => updateSection('exchanges', { markets: v ? [...s.markets, m] : s.markets.filter((x) => x !== m) })}
              />
            );
          })}
        </div>
      </Group>
    </>
  );
}

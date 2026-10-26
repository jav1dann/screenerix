'use client';

import { X } from 'lucide-react';
import { ICON_BTN } from '@/components/chart/styles';
import { CheckRow, Group, Toggle } from '@/components/shared/form';
import { METRIC_BY_KEY } from '@/lib/screener/metrics';
import { INDICATOR_GROUPS, INDICATOR_SIZES, indicatorLabel, LIVE_INDICATORS, updateSection } from '@/lib/settings/settings';
import type { IndicatorId, Settings } from '@/lib/settings/settings';
import ReorderList from '../ReorderList';

export default function IndicatorsTab({ settings }: { settings: Settings }) {
  const s = settings.indicators;
  const set = (id: IndicatorId, on: boolean) => updateSection('indicators', { items: on ? [...s.items, id] : s.items.filter((x) => x !== id) });
  const sizeIdx = INDICATOR_SIZES.indexOf(s.size);
  return (
    <>
      <Group title="Settings badge">
        <Toggle checked={s.showSettingsBadge} onChange={(showSettingsBadge) => updateSection('indicators', { showSettingsBadge })} label="Show the settings badge on chart cards" hint="The gear in each card header opens this tab." />
      </Group>
      <Group title="Indicator size">
        <div className="flex max-w-sm flex-col gap-1 px-1">
          <input
            type="range"
            min={0}
            max={INDICATOR_SIZES.length - 1}
            step={1}
            value={sizeIdx}
            aria-label="Indicator size"
            aria-valuetext={s.size}
            onChange={(e) => updateSection('indicators', { size: INDICATOR_SIZES[e.target.valueAsNumber] })}
            className="w-full accent-[#30A46C]"
          />
          <div className="flex justify-between text-[11px] font-semibold uppercase text-sx-muted">
            {INDICATOR_SIZES.map((x) => <span key={x} className={x === s.size ? 'text-sx-text' : undefined}>{x}</span>)}
          </div>
        </div>
      </Group>
      <Group title="Order" hint="Shown left to right above each chart. Drag or use the arrows.">
        <ReorderList
          label="Indicator order"
          items={s.items}
          render={indicatorLabel}
          onChange={(items) => updateSection('indicators', { items })}
          trailing={(id) => (
            <button type="button" className={ICON_BTN} onClick={() => set(id, false)} aria-label={`Remove ${indicatorLabel(id)}`} title="Remove">
              <X size={13} aria-hidden="true" />
            </button>
          )}
        />
      </Group>
      <Group title="Metrics" hint="Card stats are live; screener metrics come from the server scan and need venue support (OI, trade counts).">
        <details open className="rounded-lg border border-solid border-sx-line px-2 py-1">
          <summary className="cursor-pointer px-1 py-1 text-[13px] font-semibold">Card stats</summary>
          <div className="grid grid-cols-1 gap-0.5 pb-1 sm:grid-cols-2">
            {LIVE_INDICATORS.map((x) => <CheckRow key={x.id} label={x.label} hint={'hint' in x ? x.hint : undefined} checked={s.items.includes(x.id)} onChange={(v) => set(x.id, v)} />)}
          </div>
        </details>
        {INDICATOR_GROUPS.map((g) => {
          const picked = g.keys.filter((k) => s.items.includes(k)).length;
          return (
            <details key={g.id} className="rounded-lg border border-solid border-sx-line px-2 py-1">
              <summary className="cursor-pointer px-1 py-1 text-[13px] font-semibold">
                {g.title}{picked > 0 && <span className="ml-2 rounded bg-sx-up/15 px-1.5 text-[10px] text-sx-up">{picked}</span>}
              </summary>
              <div className="grid grid-cols-1 gap-0.5 pb-1 sm:grid-cols-2">
                {g.keys.map((k) => <CheckRow key={k} label={METRIC_BY_KEY.get(k)?.name ?? k} hint={METRIC_BY_KEY.get(k)?.hint} checked={s.items.includes(k)} onChange={(v) => set(k, v)} />)}
              </div>
            </details>
          );
        })}
      </Group>
    </>
  );
}

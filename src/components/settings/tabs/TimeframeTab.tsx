'use client';

import { CheckRow, Group, Select } from '@/components/shared/form';
import type { Timeframe } from '@/lib/market/exchanges';
import { CARD_TIMEFRAMES } from '@/lib/market/terminalPrefs';
import { updateSection } from '@/lib/settings/settings';
import type { Settings } from '@/lib/settings/settings';

const NAMES: Record<Timeframe, string> = {
  '1m': '1 minute', '3m': '3 minutes', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day',
};

export default function TimeframeTab({ settings }: { settings: Settings }) {
  const s = settings.timeframe;
  const defaults: ReadonlyArray<{ value: 'last' | Timeframe; label: string }> = [
    { value: 'last', label: 'Last session' },
    ...s.enabled.map((tf) => ({ value: tf, label: NAMES[tf] })),
  ];
  const current = s.defaultTf !== 'last' && s.enabled.includes(s.defaultTf) ? s.defaultTf : 'last';
  return (
    <>
      <Group title="Default timeframe" hint="Timeframe of the Market Map charts when the terminal opens.">
        <div className="max-w-xs">
          <Select label="Default timeframe" value={current} options={defaults} onChange={(defaultTf) => updateSection('timeframe', { defaultTf })} />
        </div>
      </Group>
      <Group title="Selectable timeframes" hint="Offered in the Market Map header.">
        <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-3" role="group" aria-label="Selectable timeframes">
          {CARD_TIMEFRAMES.map((tf) => {
            const on = s.enabled.includes(tf);
            return (
              <CheckRow
                key={tf}
                label={NAMES[tf]}
                checked={on}
                disabled={on && s.enabled.length === 1}
                onChange={(v) => updateSection('timeframe', { enabled: v ? [...s.enabled, tf] : s.enabled.filter((x) => x !== tf) })}
              />
            );
          })}
          <CheckRow label="1 week" badge="COMING SOON" checked={false} disabled onChange={() => {}} />
        </div>
      </Group>
    </>
  );
}

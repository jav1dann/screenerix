'use client';

import { BTN_RESET } from '@/components/chart/styles';
import { Group, Select } from '@/components/shared/form';
import { GRID_LAYOUTS } from '@/lib/market/terminalPrefs';
import type { GridCount, GridLayout } from '@/lib/market/terminalPrefs';
import { resetSection, updateSection } from '@/lib/settings/settings';
import type { Settings } from '@/lib/settings/settings';

/** Mini preview of a layout's cells. */
function Preview({ g }: { g: GridLayout }) {
  return (
    <span className="grid h-10 w-16 gap-px" style={{ gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gridTemplateRows: `repeat(${g.rows}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: g.count }, (_, i) => <span key={i} className="rounded-[2px] bg-current opacity-40" />)}
    </span>
  );
}

export default function TopsTab({ settings }: { settings: Settings }) {
  const s = settings.tops;
  const defaults: ReadonlyArray<{ value: 'last' | GridCount; label: string }> = [
    { value: 'last', label: 'Last session' },
    ...GRID_LAYOUTS.filter((g) => s.enabled.includes(g.count)).map((g) => ({ value: g.count, label: `${g.cols}×${g.rows} · ${g.count} charts` })),
  ];
  const current = s.defaultGrid !== 'last' && s.enabled.includes(s.defaultGrid) ? s.defaultGrid : 'last';
  return (
    <>
      <Group title="Default top layout" hint="Market Map grid when the terminal opens.">
        <div className="max-w-xs">
          <Select label="Default top layout" value={current} options={defaults} onChange={(defaultGrid) => updateSection('tops', { defaultGrid })} />
        </div>
      </Group>
      <Group
        title="Grid options"
        hint="Layouts offered in the header. Large grids mount charts as they scroll into view."
        action={<button type="button" onClick={() => resetSection('tops')} className={`${BTN_RESET} text-xs font-semibold text-sx-muted underline underline-offset-2 hover:text-sx-text`}>Reset default</button>}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Grid options">
          {GRID_LAYOUTS.map((g) => {
            const on = s.enabled.includes(g.count);
            return (
              <button
                key={g.count}
                type="button"
                aria-pressed={on}
                aria-label={`${g.cols}×${g.rows}, ${g.count} charts`}
                data-grid-option={`${g.cols}x${g.rows}`}
                disabled={on && s.enabled.length === 1}
                onClick={() => updateSection('tops', { enabled: on ? s.enabled.filter((x) => x !== g.count) : [...s.enabled, g.count] })}
                className={`${BTN_RESET} flex flex-col items-center gap-1.5 rounded-xl border border-solid p-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                  on ? 'border-sx-up/50 bg-sx-up/10 text-sx-up' : 'border-sx-line text-sx-muted hover:border-sx-line2 hover:text-sx-text'
                }`}
              >
                <Preview g={g} />
                {g.cols}×{g.rows}
              </button>
            );
          })}
        </div>
      </Group>
    </>
  );
}

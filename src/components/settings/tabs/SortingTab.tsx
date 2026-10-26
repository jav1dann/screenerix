'use client';

import { X } from 'lucide-react';
import { BTN_RESET } from '@/components/chart/styles';
import { CheckRow, Group, Select } from '@/components/shared/form';
import { useSymbolList } from '@/hooks/useTerminal';
import { exceptionStore, SORT_MODE, SORT_MODES, toggleIn, updateSection } from '@/lib/settings/settings';
import type { Settings, SortMode } from '@/lib/settings/settings';

export default function SortingTab({ settings }: { settings: Settings }) {
  const s = settings.sorting;
  const exceptions = useSymbolList(exceptionStore);
  const defaults: ReadonlyArray<{ value: 'last' | SortMode; label: string }> = [
    { value: 'last', label: 'Last session' },
    ...s.modes.map((m) => ({ value: m, label: SORT_MODE[m].title })),
  ];
  const current = s.defaultMode !== 'last' && s.modes.includes(s.defaultMode) ? s.defaultMode : 'last';
  return (
    <>
      <Group title="Default sorting mode" hint="How the Market Map ranks coins when the terminal opens.">
        <div className="max-w-xs">
          <Select label="Default sorting mode" value={current} options={defaults} onChange={(defaultMode) => updateSection('sorting', { defaultMode })} />
        </div>
      </Group>
      <Group title="Sorting metrics" hint="Offered in the Market Map sort menu, each with its windows.">
        <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2" role="group" aria-label="Sorting metrics">
          {SORT_MODES.map((m) => {
            const on = s.modes.includes(m.id);
            return (
              <CheckRow
                key={m.id}
                label={m.title}
                hint={m.hint ?? m.windows.map((w) => w.label).join(' · ')}
                checked={on}
                disabled={on && s.modes.length === 1}
                onChange={(v) => updateSection('sorting', { modes: v ? [...s.modes, m.id] : s.modes.filter((x) => x !== m.id) })}
              />
            );
          })}
        </div>
      </Group>
      <Group title="Exceptions" hint="Coins hidden from the Market Map. Add them with the ⊘ button on a chart card.">
        {exceptions.length === 0 ? (
          <p className="m-0 text-xs text-sx-muted">No exceptions.</p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Exceptions">
            {exceptions.map((sym) => (
              <li key={sym} className="inline-flex items-center gap-1 rounded-full border border-solid border-sx-line bg-white/[0.03] py-0.5 pl-2.5 pr-1 text-xs font-semibold">
                {sym}
                <button type="button" onClick={() => toggleIn(exceptionStore, sym, false)} aria-label={`Remove ${sym} from exceptions`} className={`${BTN_RESET} grid h-4 w-4 place-items-center rounded-full text-sx-muted hover:bg-white/10 hover:text-sx-text`}>
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

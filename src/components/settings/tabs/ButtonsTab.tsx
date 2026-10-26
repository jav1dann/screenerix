'use client';

import { Field, Group } from '@/components/shared/form';
import { INPUT } from '@/components/chart/styles';
import { CHART_BUTTONS, TERMINAL_BUTTONS, updateSection } from '@/lib/settings/settings';
import type { ButtonId, Settings, TerminalButton } from '@/lib/settings/settings';
import ReorderList from '../ReorderList';

const LABEL = Object.fromEntries(CHART_BUTTONS.map((b) => [b.id, b.label])) as Record<ButtonId, string>;
const NAME: Record<TerminalButton, string> = { tiger: 'Tiger', metascalp: 'Metascalp', vataga: 'Vataga', colibri: 'Colibri' };
const TIGER_ENV = Boolean(process.env.NEXT_PUBLIC_TIGER_TERMINAL_URL);

export default function ButtonsTab({ settings }: { settings: Settings }) {
  const s = settings.buttons;
  const toggle = (id: ButtonId, on: boolean) => updateSection('buttons', { enabled: on ? [...s.enabled, id] : s.enabled.filter((x) => x !== id) });
  return (
    <>
      <Group title="Buttons and order" hint="The toolbar on the left of every chart card, top to bottom. Unchecked buttons are hidden.">
        <ReorderList
          label="Chart buttons"
          items={s.order}
          render={(id) => LABEL[id]}
          dimmed={(id) => !s.enabled.includes(id)}
          onChange={(order) => updateSection('buttons', { order })}
          trailing={(id) => (
            <input
              type="checkbox"
              className="m-0 h-3.5 w-3.5 cursor-pointer accent-[#30A46C]"
              checked={s.enabled.includes(id)}
              onChange={(e) => toggle(id, e.target.checked)}
              aria-label={`Show ${LABEL[id]}`}
            />
          )}
        />
      </Group>
      <Group title="Terminal links" hint="URL each terminal button opens. Placeholders: {ticker} {symbol} {exchange} {market}. A button stays disabled until its URL is set.">
        <div className="grid grid-cols-1 gap-3">
          {TERMINAL_BUTTONS.map((id) => (
            <Field key={id} label={NAME[id]} hint={id === 'tiger' && TIGER_ENV && !s.templates.tiger ? 'Using NEXT_PUBLIC_TIGER_TERMINAL_URL' : undefined}>
              <input
                className={`${INPUT} font-mono text-xs`}
                value={s.templates[id]}
                placeholder="https://…?ticker={ticker}"
                spellCheck={false}
                aria-label={`${NAME[id]} URL template`}
                onChange={(e) => updateSection('buttons', { templates: { ...s.templates, [id]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </Group>
    </>
  );
}

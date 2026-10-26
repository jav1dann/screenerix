'use client';

import type { ReactNode } from 'react';
import { useSettings } from '@/hooks/useTerminal';
import type { ChartPrefs } from '@/lib/drawings/chartPrefs';
import { updateSection } from '@/lib/settings/settings';
import { openSettings } from '@/lib/settings/settingsUi';
import { BTN_RESET } from '../styles';

type Update = (patch: Partial<ChartPrefs>) => void;

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`${BTN_RESET} flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.05] disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      <span className="flex flex-1 flex-col">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-sx-muted">{hint}</span>}
      </span>
      <span className={`flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-sx-up' : 'justify-start bg-sx-line2'}`}>
        <span className="h-3 w-3 rounded-full bg-white" />
      </span>
    </button>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 py-1">
    <div className="px-2.5 pb-0.5 text-[10px] uppercase tracking-wide text-sx-muted">{title}</div>
    {children}
  </div>
);

export function SettingsMenu({ prefs, update, onClose }: { prefs: ChartPrefs; update: Update; onClose?: () => void }) {
  const { chart } = useSettings();
  return (
    <div className="flex w-64 flex-col">
      <Section title="Chart">
        <Switch checked={prefs.logScale} onChange={(logScale) => update({ logScale })} label="Logarithmic scale" />
        <Switch checked={chart.grid} onChange={(grid) => updateSection('chart', { grid })} label="Grid lines" />
        <Switch checked={chart.watermark.show} onChange={(show) => updateSection('chart', { watermark: { ...chart.watermark, show } })} label="Symbol watermark" />
      </Section>
      <div className="mx-1 my-1 h-px bg-sx-line" />
      <button
        type="button"
        role="menuitem"
        onClick={() => { onClose?.(); openSettings('chart'); }}
        className={`${BTN_RESET} flex w-full items-center rounded-lg px-2.5 py-1.5 text-left font-semibold text-sx-muted hover:bg-white/[0.05] hover:text-sx-text`}
      >
        All chart settings…
      </button>
    </div>
  );
}

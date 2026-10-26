'use client';

/**
 * The central Settings modal: a sidebar of seven tabs and the active tab's editor.
 * Changes apply live (like the header controls); each tab has "Reset default".
 * Open it from anywhere with `openSettings(tab)`.
 */
import { useEffect, useEffectEvent, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { BTN_RESET, GHOST_BTN, ICON_BTN, PRIMARY_BTN } from '@/components/chart/styles';
import { useSettings, useSettingsUi } from '@/hooks/useTerminal';
import { resetSection, SETTINGS_TABS } from '@/lib/settings/settings';
import type { SettingsTab } from '@/lib/settings/settings';
import { closeSettings, selectSettingsTab } from '@/lib/settings/settingsUi';
import SettingsPreview from './SettingsPreview';
import ButtonsTab from './tabs/ButtonsTab';
import ChartTab from './tabs/ChartTab';
import ExchangesTab from './tabs/ExchangesTab';
import IndicatorsTab from './tabs/IndicatorsTab';
import SortingTab from './tabs/SortingTab';
import TimeframeTab from './tabs/TimeframeTab';
import TopsTab from './tabs/TopsTab';

/** Tabs that change how a chart card looks get a live card preview. */
const PREVIEW_TABS: ReadonlySet<SettingsTab> = new Set(['indicators', 'chart', 'buttons']);

const PANES: Record<SettingsTab, typeof ExchangesTab> = {
  exchanges: ExchangesTab, sorting: SortingTab, timeframe: TimeframeTab, tops: TopsTab,
  indicators: IndicatorsTab, chart: ChartTab, buttons: ButtonsTab,
};

export default function SettingsModal() {
  const ui = useSettingsUi();
  if (!ui.open) return null;
  return <SettingsDialog tab={ui.tab} />;
}

function SettingsDialog({ tab }: { tab: SettingsTab }) {
  const settings = useSettings();
  const ids = useId();
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeSettings();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    const i = SETTINGS_TABS.findIndex((t) => t.id === tab);
    let next: number | undefined;
    if (step !== undefined) next = (i + step + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SETTINGS_TABS.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    const id = SETTINGS_TABS[next].id;
    selectSettingsTab(id);
    tabRefs.current.get(id)?.focus();
  };

  const Pane = PANES[tab];
  const label = SETTINGS_TABS.find((t) => t.id === tab)?.label ?? '';

  return createPortal(
    <div className="fixed inset-0 z-[125] grid place-items-center p-3 text-sx-text md:p-6 [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label="Close settings" onClick={closeSettings} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        data-settings-modal
        className="relative flex h-[min(720px,calc(100vh-24px))] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3.5">
          <SettingsIcon size={16} className="text-sx-muted" aria-hidden="true" />
          <h2 id={`${ids}-title`} className="m-0 text-[15px] font-semibold">Settings</h2>
          <button type="button" onClick={closeSettings} aria-label="Close" className={`${ICON_BTN} ml-auto`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings sections"
            onKeyDown={onTabKey}
            className="sx-noscroll flex shrink-0 gap-1 overflow-x-auto border-0 border-b border-solid border-sx-line p-2 md:w-56 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3"
          >
            {SETTINGS_TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => { if (el) tabRefs.current.set(t.id, el); else tabRefs.current.delete(t.id); }}
                type="button"
                role="tab"
                id={`${ids}-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${ids}-panel`}
                tabIndex={tab === t.id ? 0 : -1}
                data-tab={t.id}
                onClick={() => selectSettingsTab(t.id)}
                className={`${BTN_RESET} shrink-0 rounded-lg px-3 py-2 text-left text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-sx-up md:whitespace-normal ${
                  tab === t.id ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:bg-white/[0.04] hover:text-sx-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel`}
            aria-labelledby={`${ids}-tab-${tab}`}
            data-panel={tab}
            // With the sticky preview, fields scrolled into view (focus, find) stop below it.
            className={`sx-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 ${PREVIEW_TABS.has(tab) ? 'md:scroll-pt-[340px]' : ''}`}
          >
            <h3 className="m-0 text-base font-semibold">{label}</h3>
            {PREVIEW_TABS.has(tab) && <SettingsPreview />}
            <Pane settings={settings} />
          </div>
        </div>
        <div className="flex items-center gap-2 border-0 border-t border-solid border-sx-line px-5 py-3">
          <button type="button" className={GHOST_BTN} onClick={() => resetSection(tab)}>
            <RotateCcw size={13} className="mr-1.5" aria-hidden="true" />Reset default
          </button>
          <span className="hidden text-[11px] text-[#6B6E78] sm:inline">Changes apply instantly and are saved in this browser.</span>
          <button type="button" className={`${PRIMARY_BTN} ml-auto`} onClick={closeSettings}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

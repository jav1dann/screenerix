'use client';

/**
 * The Indicator modal: search, then Popular / Main / Sub sections. Toggling an
 * indicator applies at once to every chart of the window type (Market Map cards,
 * or the expanded / Review chart); active ones expand to edit their parameters.
 */
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, RotateCcw, Search, Settings2, SquareFunction, X } from 'lucide-react';
import { BTN_RESET, ICON_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { NumberInput } from '@/components/shared/form';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { useIndicators, useIndicatorUi } from '@/hooks/useTerminal';
import { unavailableReason } from '@/lib/indicators/engine';
import { defaultParams, GROUP_TITLE, INDICATOR_BY_ID, INDICATORS, OI_INDICATORS } from '@/lib/indicators/registry';
import type { IndicatorDef, IndicatorGroup } from '@/lib/indicators/registry';
import { moveIndicator, removeIndicator, setParams, setVisible, toggleIndicator } from '@/lib/indicators/store';
import type { ActiveIndicator, IndicatorScope } from '@/lib/indicators/store';
import { closeIndicators } from '@/lib/indicators/ui';
import type { IndicatorWindow } from '@/lib/indicators/ui';

const SCOPE_NOTE: Record<IndicatorScope, string> = {
  card: 'Applies to every Market Map chart',
  chart: 'Applies to the expanded, Market Review and spread charts',
};
const GROUPS: readonly IndicatorGroup[] = ['popular', 'main', 'sub'];

export default function IndicatorModal() {
  const ui = useIndicatorUi();
  if (!ui.open) return null;
  return <IndicatorDialog key={`${ui.scope}|${ui.focus}`} scope={ui.scope} win={ui.window} focus={ui.focus} />;
}

const matches = (d: IndicatorDef, q: string) => !q || `${d.name} ${d.title} ${d.description}`.toLowerCase().includes(q);

function IndicatorDialog({ scope, win, focus }: { scope: IndicatorScope; win: IndicatorWindow | null; focus: string | null }) {
  const ids = useId();
  const active = useIndicators(scope);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(focus);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (query) setQuery('');
    else closeIndicators();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    searchRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const ctx = { exchange: win?.exchange ?? null, market: win?.market ?? 'futures' } as const;
  const hint = (d: IndicatorDef) => (win ? unavailableReason(d, ctx) : d.soon ? 'Coming soon' : null);
  const isOn = (id: string) => active.some((a) => a.id === id);

  const groups = useMemo(() => GROUPS.map((g) => ({
    id: g,
    items: INDICATORS.filter((d) => d.group === g && !d.oiVenue && matches(d, q)),
    oi: g === 'popular' ? OI_INDICATORS.filter((d) => matches(d, q) || (q && 'open interest'.includes(q))) : [],
  })), [q]);
  const activeShown = active.filter((a) => { const d = INDICATOR_BY_ID.get(a.id); return d && matches(d, q); });
  const nothing = !activeShown.length && groups.every((g) => !g.items.length && !g.oi.length);
  const isOpen = (key: string) => Boolean(q) || !closed.has(key);
  const toggleSection = (key: string) => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const row = (d: IndicatorDef, indent = false) => {
    const on = isOn(d.id);
    const why = hint(d);
    return (
      <label
        key={d.id}
        data-indicator-row={d.id}
        className={`flex items-center gap-3 rounded-lg py-2 pr-2 ${indent ? 'pl-7' : 'pl-2.5'} ${d.soon ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-white/[0.04]'}`}
      >
        <input
          type="checkbox"
          className="m-0 h-3.5 w-3.5 shrink-0 cursor-[inherit] accent-[#30A46C]"
          checked={on}
          disabled={d.soon}
          onChange={(e) => toggleIndicator(scope, d.id, e.target.checked)}
          aria-label={d.title}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            {indent && !/^oi.(global|self)$/.test(d.id) && <ExchangeIcon name={d.title.split('· ')[1] ?? ''} size={14} />}
            {d.title}
            {d.soon && <span className="rounded bg-white/[0.07] px-1.5 py-px text-[9px] font-bold tracking-wide text-sx-muted">SOON</span>}
          </span>
          <span className="truncate text-[11px] text-[#6B6E78]">{why && !d.soon ? `${d.description} · ${why}` : d.description}</span>
        </span>
      </label>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] grid place-items-center p-3 text-sx-text md:p-6 [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label="Close indicators" onClick={closeIndicators} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} data-indicator-modal className="relative flex h-[min(760px,calc(100vh-24px))] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3.5">
          <SquareFunction size={16} className="text-sx-muted" aria-hidden="true" />
          <div className="flex min-w-0 flex-col">
            <h2 id={`${ids}-title`} className="m-0 text-[15px] font-semibold">Indicator</h2>
            <span className="truncate text-[11px] text-[#6B6E78]">{SCOPE_NOTE[scope]}{win?.symbol ? ` · now on ${win.symbol}` : ''}</span>
          </div>
          <button type="button" onClick={closeIndicators} aria-label="Close" className={`${ICON_BTN} ml-auto`}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="border-0 border-b border-solid border-sx-line px-4 py-3">
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute left-3 text-sx-muted" aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter indicator name" aria-label="Search indicators" className={`${INPUT} pl-9`} />
          </label>
        </div>
        <div className="sx-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {nothing && <p className="m-0 px-2 py-8 text-center text-sm text-sx-muted">No indicators match “{query}”.</p>}
          {activeShown.length > 0 && (
            <Section id="active" title={`Active (${active.length})`} open={isOpen('active')} onToggle={() => toggleSection('active')}>
              {activeShown.map((a, i) => (
                <ActiveRow key={a.uid} scope={scope} inst={a} first={i === 0} last={i === activeShown.length - 1} expanded={expanded === a.uid}
                  onExpand={() => setExpanded((x) => (x === a.uid ? null : a.uid))} why={hint(INDICATOR_BY_ID.get(a.id) as IndicatorDef)} />
              ))}
            </Section>
          )}
          {groups.map((g) => (g.items.length || g.oi.length) ? (
            <Section key={g.id} id={g.id} title={GROUP_TITLE[g.id]} open={isOpen(g.id)} onToggle={() => toggleSection(g.id)}>
              {g.items.map((d) => row(d))}
              {g.oi.length > 0 && (
                <div data-indicator-group="oi">
                  <button type="button" onClick={() => toggleSection('oi')} aria-expanded={isOpen('oi')} className={`${BTN_RESET} flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04]`}>
                    <ChevronDown size={14} className={`shrink-0 text-sx-muted transition-transform ${isOpen('oi') ? '' : '-rotate-90'}`} aria-hidden="true" />
                    <span className="flex flex-col">
                      <span className="text-[13px] font-semibold">Open Interest {g.oi.filter((d) => isOn(d.id)).length > 0 && <span className="ml-1 rounded bg-sx-up/15 px-1.5 text-[10px] text-sx-up">{g.oi.filter((d) => isOn(d.id)).length}</span>}</span>
                      <span className="text-[11px] text-[#6B6E78]">Global, the chart&apos;s exchange, or a specific venue</span>
                    </span>
                  </button>
                  {isOpen('oi') && g.oi.map((d) => row(d, true))}
                </div>
              )}
            </Section>
          ) : null)}
        </div>
        <div className="flex items-center gap-2 border-0 border-t border-solid border-sx-line px-5 py-3">
          <span className="text-[11px] text-[#6B6E78]">{active.length} active · saved in this browser</span>
          <button type="button" className={`${PRIMARY_BTN} ml-auto`} onClick={closeIndicators}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section data-section={id} className="flex flex-col">
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${BTN_RESET} sticky top-0 z-10 flex items-center gap-2 bg-[#111215] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-sx-muted hover:text-sx-text`}>
        <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
        {title}
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </section>
  );
}

function ActiveRow({ scope, inst, first, last, expanded, onExpand, why }: {
  scope: IndicatorScope; inst: ActiveIndicator; first: boolean; last: boolean; expanded: boolean; onExpand: () => void; why: string | null;
}) {
  const def = INDICATOR_BY_ID.get(inst.id);
  if (!def) return null;
  const summary = inst.params.length ? `(${inst.params.join(', ')})` : '';
  return (
    <div data-active-row={inst.id} className={`rounded-lg ${expanded ? 'bg-white/[0.04]' : ''}`}>
      <div className="flex items-center gap-1 py-1 pl-2.5 pr-1">
        <span className={`flex min-w-0 flex-1 flex-col ${inst.visible ? '' : 'opacity-50'}`}>
          <span className="truncate text-[13px] font-semibold">{def.name} <span className="font-normal text-sx-muted">{summary}</span></span>
          {why && <span className="truncate text-[11px] text-[#6B6E78]">{why}</span>}
        </span>
        <button type="button" className={ICON_BTN} onClick={() => setVisible(scope, inst.uid, !inst.visible)} aria-pressed={!inst.visible} aria-label={inst.visible ? `Hide ${def.name}` : `Show ${def.name}`} title={inst.visible ? 'Hide' : 'Show'}>
          {inst.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        </button>
        {def.params.length > 0 && (
          <button type="button" className={`${ICON_BTN} ${expanded ? 'text-sx-text' : ''}`} onClick={onExpand} aria-expanded={expanded} aria-label={`${def.name} settings`} title="Parameters">
            <Settings2 size={14} aria-hidden="true" />
          </button>
        )}
        <button type="button" className={ICON_BTN} disabled={first} onClick={() => moveIndicator(scope, inst.uid, -1)} aria-label={`Move ${def.name} up`} title="Move up"><ArrowUp size={13} aria-hidden="true" /></button>
        <button type="button" className={ICON_BTN} disabled={last} onClick={() => moveIndicator(scope, inst.uid, 1)} aria-label={`Move ${def.name} down`} title="Move down"><ArrowDown size={13} aria-hidden="true" /></button>
        <button type="button" className={`${ICON_BTN} hover:text-sx-down`} onClick={() => removeIndicator(scope, inst.uid)} aria-label={`Remove ${def.name}`} title="Remove"><X size={14} aria-hidden="true" /></button>
      </div>
      {expanded && def.params.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-2.5 pb-3 pt-1 sm:grid-cols-3">
          {def.params.map((p, i) => (
            <label key={p.label} className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-sx-muted">{p.label}</span>
              <NumberInput label={`${def.name} ${p.label}`} value={inst.params[i] ?? p.def} min={p.min} max={p.max} step={p.step} onChange={(v) => setParams(scope, inst.uid, inst.params.map((x, j) => (j === i ? v : x)))} />
            </label>
          ))}
          <button type="button" onClick={() => setParams(scope, inst.uid, defaultParams(def))} className={`${BTN_RESET} col-span-full flex items-center gap-1.5 justify-self-start text-xs font-semibold text-sx-muted hover:text-sx-text`}>
            <RotateCcw size={12} aria-hidden="true" />Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

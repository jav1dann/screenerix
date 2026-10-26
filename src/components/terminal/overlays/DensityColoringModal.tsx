'use client';

/** Densities → Coloring: presets, and the size tiers / font / asks / bids colors. Save persists. */
import { useState } from 'react';
import { Palette, Trash2 } from 'lucide-react';
import { GHOST_BTN, ICON_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { useColoringPresets } from '@/hooks/useDensities';
import { fmtUsd } from '@/lib/format';
import { tierColor } from '@/lib/densities/detect';
import { BUILTIN_COLORING_PRESETS, DEFAULT_COLORING, deleteColoringPreset, sanitizeColoring, saveColoringPreset } from '@/lib/densities/settings';
import type { DensityColoring } from '@/lib/densities/settings';
import DensityModal, { ColorInput, Field, NumberInput } from './DensityModal';

type Tab = 'presets' | 'settings';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [{ id: 'presets', label: 'Presets' }, { id: 'settings', label: 'Settings' }];

/** Sample rows for the live preview. */
const SAMPLE = [
  { side: 'ask' as const, notional: 2_600_000, price: '1.2840', dist: '+2.10%' },
  { side: 'ask' as const, notional: 640_000, price: '1.2702', dist: '+1.01%' },
  { side: 'bid' as const, notional: 320_000, price: '1.2488', dist: '−0.69%' },
  { side: 'bid' as const, notional: 1_100_000, price: '1.2390', dist: '−1.47%' },
];

function Swatches({ c }: { c: DensityColoring }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[c.bids, c.asks, c.size1.color, c.size2.color].map((x, i) => <span key={i} className="h-3.5 w-3.5 rounded-sm" style={{ background: x }} />)}
    </span>
  );
}

interface DensityColoringModalProps {
  coloring: DensityColoring;
  onSave: (c: DensityColoring) => void;
  onClose: () => void;
}

export default function DensityColoringModal({ coloring, onSave, onClose }: DensityColoringModalProps) {
  const [tab, setTab] = useState<Tab>('settings');
  const [draft, setDraft] = useState<DensityColoring>(coloring);
  const [name, setName] = useState('');
  const presets = useColoringPresets();
  const set = (patch: Partial<DensityColoring>) => setDraft((d) => ({ ...d, ...patch }));
  const max = Math.max(...SAMPLE.map((s) => s.notional));

  const footer = (
    <>
      <button type="button" className={GHOST_BTN} onClick={() => setDraft(DEFAULT_COLORING)}>Reset default</button>
      <button type="button" className={`${GHOST_BTN} ml-auto`} onClick={onClose}>Cancel</button>
      <button type="button" className={PRIMARY_BTN} onClick={() => onSave(sanitizeColoring(draft))}>Save</button>
    </>
  );

  return (
    <DensityModal title="Coloring" icon={<Palette size={16} />} tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} footer={footer}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_220px]">
        <div className="flex min-w-0 flex-col gap-4">
          {tab === 'presets' && (
            <>
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Coloring presets">
                {[...BUILTIN_COLORING_PRESETS, ...presets].map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg border border-solid border-sx-line px-3 py-2">
                    <Swatches c={sanitizeColoring(p.coloring)} />
                    <span className="flex-1 text-[13px] font-semibold">{p.name}</span>
                    <button type="button" className={`${GHOST_BTN} px-3 py-1 text-xs`} onClick={() => setDraft(sanitizeColoring(p.coloring))}>Use</button>
                    {!p.builtIn && (
                      <button type="button" className={`${ICON_BTN} text-rose-400`} aria-label={`Delete preset ${p.name}`} onClick={() => deleteColoringPreset(p.id)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { saveColoringPreset(name, sanitizeColoring(draft)); setName(''); } }}>
                <input className={INPUT} placeholder="Save current colors as…" aria-label="Preset name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className={`${GHOST_BTN} shrink-0`} disabled={!name.trim()}>Save preset</button>
              </form>
            </>
          )}
          {tab === 'settings' && (
            <>
              <section className="flex flex-col gap-3">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-sx-muted">High densities</h3>
                {(['size1', 'size2'] as const).map((k, i) => (
                  <div key={k} className="grid grid-cols-2 gap-3">
                    <Field label={`Size ${i + 1} from`}>
                      <NumberInput label={`Size ${i + 1} threshold`} value={draft[k].min} min={0} step={100_000} suffix="$" onChange={(min) => set({ [k]: { ...draft[k], min } })} />
                    </Field>
                    <Field label={`Size ${i + 1} color`}>
                      <ColorInput label={`Size ${i + 1} color`} value={draft[k].color} onChange={(color) => set({ [k]: { ...draft[k], color } })} />
                    </Field>
                  </div>
                ))}
                {draft.size2.min <= draft.size1.min && <span className="text-[11px] text-sx-alert">Size 2 should start above Size 1 — larger sizes use Size 2.</span>}
              </section>
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Font"><ColorInput label="Font color" value={draft.font} onChange={(font) => set({ font })} /></Field>
                <Field label="Asks"><ColorInput label="Asks color" value={draft.asks} onChange={(asks) => set({ asks })} /></Field>
                <Field label="Bids"><ColorInput label="Bids color" value={draft.bids} onChange={(bids) => set({ bids })} /></Field>
              </section>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1.5" aria-label="Preview">
          <span className="text-xs font-semibold text-sx-muted">Preview</span>
          <div className="rounded-xl border border-solid border-sx-line bg-[#0D0E11] p-2.5 text-[11px]" style={{ color: draft.font }} data-preview>
            <div className="mb-1.5 flex items-center justify-between font-bold"><span>EXAMPLE</span><span className="tabular-nums">1.2575</span></div>
            {SAMPLE.map((s) => (
              <div key={s.price} className="relative mb-0.5 grid grid-cols-[1fr_auto_auto] gap-2 rounded px-1.5 py-0.5 tabular-nums">
                <span className="absolute inset-y-0 left-0 rounded opacity-25" style={{ width: `${(s.notional / max) * 100}%`, background: tierColor(s, draft) }} />
                <span className="relative" style={{ color: s.side === 'ask' ? draft.asks : draft.bids }}>{s.price}</span>
                <span className="relative font-semibold" style={{ color: tierColor(s, draft) }}>{fmtUsd(s.notional)}</span>
                <span className="relative opacity-70">{s.dist}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DensityModal>
  );
}

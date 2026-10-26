'use client';

/**
 * Densities → Filters: Presets, General, Instrument types, Nesting, Individual
 * (per-coin minimum size) and Blacklist. Edits a draft; Apply saves it.
 */
import { useId, useState } from 'react';
import { Funnel, Plus, Trash2, X } from 'lucide-react';
import { BTN_RESET, GHOST_BTN, ICON_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { useFilterPresets } from '@/hooks/useDensities';
import { fmtPrice, fmtUsd } from '@/lib/format';
import { BUILTIN_FILTER_PRESETS, DEFAULT_FILTERS, deleteFilterPreset, fmtLifetime, MIN_LIFETIME_OPTIONS, NESTING_CHOICES, sanitizeFilters, saveFilterPreset } from '@/lib/densities/settings';
import { DENSITY_FLOOR, DENSITY_RANGE } from '@/lib/scan/types';
import type { DensityFilters, DensitySide } from '@/lib/densities/settings';
import type { DensityMarket } from '@/lib/densities/types';
import { Select } from '@/components/shared/form';
import ModeSwitch from './ModeSwitch';
import DensityModal, { Field, NumberInput } from './DensityModal';

type Tab = 'presets' | 'general' | 'instruments' | 'nesting' | 'individual' | 'blacklist';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'presets', label: 'Presets' },
  { id: 'general', label: 'General' },
  { id: 'instruments', label: 'Instrument types' },
  { id: 'nesting', label: 'Nesting' },
  { id: 'individual', label: 'Individual' },
  { id: 'blacklist', label: 'Blacklist' },
];
const SIDES: ReadonlyArray<{ id: DensitySide; label: string }> = [{ id: 'both', label: 'Both' }, { id: 'bids', label: 'Bids' }, { id: 'asks', label: 'Asks' }];
const SYMBOL = /^[\p{Lu}\p{Lo}\p{N}]{1,20}$/u;
const norm = (s: string) => s.trim().toUpperCase();
/** The lifetime presets, plus the stored value when it isn't one of them (older settings). */
const lifetimeOptions = (cur: number) => [
  ...MIN_LIFETIME_OPTIONS.map((v) => ({ value: v, label: fmtLifetime(v) })),
  ...(MIN_LIFETIME_OPTIONS.includes(cur) ? [] : [{ value: cur, label: `Custom (${fmtLifetime(cur)})` }]),
];

interface DensityFiltersModalProps {
  filters: DensityFilters;
  markets: readonly DensityMarket[];
  /** Coins seen so far (suggestions). */
  symbols: readonly string[];
  onApply: (filters: DensityFilters, markets: DensityMarket[]) => void;
  onClose: () => void;
}

export default function DensityFiltersModal({ filters, markets, symbols, onApply, onClose }: DensityFiltersModalProps) {
  const ids = useId();
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState<DensityFilters>(filters);
  const [mkts, setMkts] = useState<DensityMarket[]>([...markets]);
  const presets = useFilterPresets();
  const [presetName, setPresetName] = useState('');
  const [indSymbol, setIndSymbol] = useState('');
  const [indSize, setIndSize] = useState(1_000_000);
  const [black, setBlack] = useState('');
  const set = (patch: Partial<DensityFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleMarket = (m: DensityMarket, on: boolean) => setMkts((cur) => {
    const next = on ? [...new Set([...cur, m])] : cur.filter((x) => x !== m);
    return next.length ? (['futures', 'spot'] as const).filter((x) => next.includes(x)) : cur; // keep at least one
  });

  const addIndividual = () => {
    const symbol = norm(indSymbol);
    if (!SYMBOL.test(symbol) || !(indSize >= 0)) return;
    set({ individual: [...draft.individual.filter((x) => x.symbol !== symbol), { symbol, minSize: indSize }] });
    setIndSymbol('');
  };
  const addBlack = (raw: string) => {
    const symbol = norm(raw);
    if (!SYMBOL.test(symbol) || draft.blacklist.includes(symbol)) return;
    set({ blacklist: [...draft.blacklist, symbol] });
    setBlack('');
  };
  const suggestions = symbols.filter((s) => !draft.blacklist.includes(s));
  const all = [...BUILTIN_FILTER_PRESETS, ...presets];

  const footer = (
    <>
      <button type="button" className={GHOST_BTN} onClick={() => { setDraft(DEFAULT_FILTERS); setMkts(['futures']); }}>Reset</button>
      <button type="button" className={`${GHOST_BTN} ml-auto`} onClick={onClose}>Cancel</button>
      <button type="button" className={PRIMARY_BTN} onClick={() => onApply(sanitizeFilters(draft), mkts)}>Apply</button>
    </>
  );

  return (
    <DensityModal title="Filters" icon={<Funnel size={16} />} tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} footer={footer}>
      {tab === 'presets' && (
        <div className="flex flex-col gap-3">
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Filter presets">
            {all.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg border border-solid border-sx-line px-3 py-2">
                <span className="flex-1 text-[13px] font-semibold">{p.name}</span>
                {p.builtIn && <span className="rounded bg-white/[0.06] px-1.5 text-[10px] font-semibold text-sx-muted">Built-in</span>}
                <button type="button" className={`${GHOST_BTN} px-3 py-1 text-xs`} onClick={() => { setDraft(sanitizeFilters(p.filters)); setTab('general'); }}>Use</button>
                {!p.builtIn && (
                  <button type="button" className={`${ICON_BTN} text-rose-400`} aria-label={`Delete preset ${p.name}`} onClick={() => deleteFilterPreset(p.id)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (presetName.trim()) { saveFilterPreset(presetName, sanitizeFilters(draft)); setPresetName(''); } }}>
            <input className={INPUT} placeholder="Save current settings as…" aria-label="Preset name" value={presetName} maxLength={40} onChange={(e) => setPresetName(e.target.value)} />
            <button type="submit" className={`${GHOST_BTN} shrink-0`} disabled={!presetName.trim()}>Save preset</button>
          </form>
        </div>
      )}

      {tab === 'general' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Minimum density size" hint={`From ${fmtUsd(DENSITY_FLOOR)} — the server tracks every density above that`}>
            <NumberInput label="Minimum density size" value={draft.minSize} min={DENSITY_FLOOR} step={50_000} suffix="$" onChange={(minSize) => set({ minSize })} />
          </Field>
          <Field label="Max distance from price" hint={`Up to ${DENSITY_RANGE}% (the server tracks ±${DENSITY_RANGE}%)`}>
            <NumberInput label="Max distance" value={draft.maxDistance} min={0.01} max={DENSITY_RANGE} step={0.1} suffix="%" onChange={(maxDistance) => set({ maxDistance })} />
          </Field>
          <Field label="Minimum lifetime" hint="How long a density must have stood in the book">
            <Select label="Minimum lifetime" value={draft.minLifetime} options={lifetimeOptions(draft.minLifetime)} onChange={(minLifetime) => set({ minLifetime })} />
          </Field>
          <Field label="Minimum 24h volume" hint={`Coins below ${fmtUsd(draft.minVolume24h)} aren't scanned`}>
            <NumberInput label="Minimum 24h volume" value={draft.minVolume24h} min={0} step={1_000_000} suffix="$" onChange={(minVolume24h) => set({ minVolume24h })} />
          </Field>
          <Field label="Size vs. book median" hint="Also require ≥ N × the median level (0 = off)">
            <NumberInput label="Size multiple" value={draft.multiple} min={0} max={1000} step={1} suffix="×" onChange={(multiple) => set({ multiple })} />
          </Field>
          <Field label="Densities per card">
            <NumberInput label="Densities per card" value={draft.perCard} min={1} max={12} step={1} onChange={(perCard) => set({ perCard: Math.round(perCard) })} />
          </Field>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span id={`${ids}-side`} className="text-xs font-semibold text-sx-muted">Side</span>
            <div role="radiogroup" aria-labelledby={`${ids}-side`} className="flex gap-1 self-start rounded-lg border border-solid border-sx-line p-0.5">
              {SIDES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={draft.side === s.id} onClick={() => set({ side: s.id })}
                  className={`${BTN_RESET} rounded-md px-3 py-1 text-xs font-semibold ${draft.side === s.id ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'instruments' && (
        <div className="flex flex-col gap-1">
          <ModeSwitch checked={mkts.includes('futures')} onChange={(on) => toggleMarket('futures', on)} label="Perpetual futures" showLabel />
          <ModeSwitch checked={mkts.includes('spot')} onChange={(on) => toggleMarket('spot', on)} label="Spot" showLabel />
          <span className="mb-2 text-[11px] text-[#6B6E78]">At least one market stays on (same as the Futures / Spot toggles in the bar).</span>
          <ModeSwitch checked={draft.excludeStable} onChange={(excludeStable) => set({ excludeStable })} label="Exclude stablecoins (USDC, FDUSD, DAI, …)" showLabel />
          <ModeSwitch checked={draft.excludeLeveraged} onChange={(excludeLeveraged) => set({ excludeLeveraged })} label="Exclude leveraged tokens (BTCUP, ETH3L, …)" showLabel />
        </div>
      )}

      {tab === 'nesting' && (
        <div className="flex flex-col gap-4">
          <ModeSwitch checked={draft.nesting.enabled} onChange={(enabled) => set({ nesting: { ...draft.nesting, enabled } })} label="Merge neighbouring levels" showLabel />
          <div className="flex flex-col gap-1.5">
            <span id={`${ids}-step`} className="text-xs font-semibold text-sx-muted">Step</span>
            <div role="radiogroup" aria-labelledby={`${ids}-step`} className="flex gap-1 self-start rounded-lg border border-solid border-sx-line p-0.5">
              {NESTING_CHOICES.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={draft.nesting.stepPct === x} onClick={() => set({ nesting: { ...draft.nesting, stepPct: x } })}
                  className={`${BTN_RESET} rounded-md px-3 py-1 text-xs font-semibold tabular-nums ${draft.nesting.stepPct === x ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}>
                  {x}%
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[#6B6E78]">Levels within one step of price are summed into a single density (the server keeps each step ready).</span>
          </div>
          <p className="m-0 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-sx-muted">
            {draft.nesting.enabled
              ? <>Example: at $81,500 a {draft.nesting.stepPct}% step merges levels within ${fmtPrice((81_500 * draft.nesting.stepPct) / 100)} into one density.</>
              : 'Off: every order-book level is judged on its own.'}
          </p>
        </div>
      )}

      {tab === 'individual' && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-xs text-sx-muted">Per-coin minimum density size, replacing the general {fmtUsd(draft.minSize)} (e.g. higher for BTC / ETH).</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Individual sizes">
            {draft.individual.length === 0 && <li className="text-xs text-[#6B6E78]">No individual sizes yet.</li>}
            {draft.individual.map((x) => (
              <li key={x.symbol} className="flex items-center gap-2 rounded-lg border border-solid border-sx-line px-3 py-1.5">
                <span className="w-24 text-[13px] font-semibold">{x.symbol}</span>
                <span className="flex-1">
                  <NumberInput label={`${x.symbol} minimum size`} value={x.minSize} min={0} step={100_000} suffix="$" onChange={(minSize) => set({ individual: draft.individual.map((y) => (y.symbol === x.symbol ? { ...y, minSize } : y)) })} />
                </span>
                <button type="button" className={`${ICON_BTN} text-rose-400`} aria-label={`Remove ${x.symbol}`} onClick={() => set({ individual: draft.individual.filter((y) => y.symbol !== x.symbol) })}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addIndividual(); }}>
            <input className={`${INPUT} w-32`} placeholder="Coin" aria-label="Coin" list={`${ids}-syms`} value={indSymbol} onChange={(e) => setIndSymbol(e.target.value)} />
            <span className="flex-1"><NumberInput label="Coin minimum size" value={indSize} min={0} step={100_000} suffix="$" onChange={setIndSize} /></span>
            <button type="submit" className={`${GHOST_BTN} shrink-0 gap-1.5`} disabled={!SYMBOL.test(norm(indSymbol))}><Plus size={14} aria-hidden="true" />Add</button>
          </form>
        </div>
      )}

      {tab === 'blacklist' && (
        <div className="flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addBlack(black); }}>
            <input className={INPUT} placeholder="Coin to hide, Enter to add" aria-label="Coin to blacklist" list={`${ids}-syms`} value={black} onChange={(e) => setBlack(e.target.value)} />
            <button type="submit" className={`${GHOST_BTN} shrink-0`} disabled={!SYMBOL.test(norm(black))}>Add</button>
          </form>
          <div className="flex flex-wrap gap-1.5" aria-label="Blacklisted coins">
            {draft.blacklist.length === 0 && <span className="text-xs text-[#6B6E78]">No coins blacklisted.</span>}
            {draft.blacklist.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-solid border-sx-line2 bg-white/[0.04] py-0.5 pl-2.5 pr-1 text-xs font-semibold">
                {s}
                <button type="button" aria-label={`Remove ${s} from blacklist`} onClick={() => set({ blacklist: draft.blacklist.filter((x) => x !== s) })} className={`${BTN_RESET} grid h-4 w-4 place-items-center rounded-full text-sx-muted hover:bg-white/10 hover:text-sx-text`}>
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <datalist id={`${ids}-syms`}>{suggestions.slice(0, 300).map((s) => <option key={s} value={s} />)}</datalist>
    </DensityModal>
  );
}

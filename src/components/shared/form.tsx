'use client';

/** Small form controls shared by the Densities modals and the Settings modal. */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { INPUT } from '@/components/chart/styles';

/** Labelled form row. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-sx-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[#6B6E78]">{hint}</span>}
    </label>
  );
}

/** Text the user is typing, re-synced whenever the bound value changes from outside. */
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  const [bound, setBound] = useState(value);
  if (bound !== value) { setBound(value); setDraft(value); }
  return [draft, setDraft];
}

/** Number input bound to a numeric value; text that isn't a number in range is kept but not applied. */
export function NumberInput({ value, onChange, step, min, max, label, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string }) {
  const [draft, setDraft] = useDraft(String(value));
  return (
    <span className="relative flex items-center">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
        }}
        className={`${INPUT} ${suffix ? 'pr-10' : ''}`}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-xs text-sx-muted">{suffix}</span>}
    </span>
  );
}

/** Color swatch + hex input. */
export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useDraft(value);
  return (
    <span className="flex items-center gap-2">
      <input type="color" aria-label={label} value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-solid border-sx-line bg-transparent p-0.5" />
      <input
        aria-label={`${label} hex`}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase()); }}
        className={`${INPUT} font-mono uppercase`}
        maxLength={7}
      />
    </span>
  );
}

/** On / off switch row. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="box-border flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left font-[inherit] text-[13px] text-sx-text hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-[#6B6E78]">{hint}</span>}
      </span>
      <span className={`flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-sx-up' : 'justify-start bg-sx-line2'}`} aria-hidden="true">
        <span className="h-3 w-3 rounded-full bg-white" />
      </span>
    </button>
  );
}

/** Checkbox with a label, an optional badge (ALPHA / SOON) and hint. */
export function CheckRow({ checked, onChange, label, badge, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; badge?: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-white/[0.04]'}`}>
      <input type="checkbox" className="m-0 h-3.5 w-3.5 shrink-0 cursor-[inherit] accent-[#30A46C]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          {label}
          {badge && <span className="rounded bg-white/[0.07] px-1.5 py-px text-[9px] font-bold tracking-wide text-sx-muted">{badge}</span>}
        </span>
        {hint && <span className="text-[11px] text-[#6B6E78]">{hint}</span>}
      </span>
    </label>
  );
}

/** Native select styled like the other inputs. */
export function Select<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>; label: string }) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}
      className={`${INPUT} cursor-pointer appearance-auto`}
    >
      {options.map((o) => <option key={String(o.value)} value={String(o.value)} className="bg-[#14151A]">{o.label}</option>)}
    </select>
  );
}

/** Titled block inside a settings pane. */
export function Group({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-sx-muted">{title}</h3>
          {hint && <p className="m-0 text-[11px] text-[#6B6E78]">{hint}</p>}
        </div>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

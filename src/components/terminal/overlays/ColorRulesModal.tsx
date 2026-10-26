'use client';

/**
 * Color rules: per metric, breakpoints → colors for the Market Review ticker list and
 * the chart-card headers. Edits stay in a draft until Save.
 */
import { useId, useState } from 'react';
import { Palette, Plus, Trash2 } from 'lucide-react';
import { GHOST_BTN, ICON_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { useColorRules } from '@/hooks/useTerminal';
import { colorRuleStore, DEFAULT_STOPS, fmtRuleValue, RULE_GROUPS, ruleColor, ruleMetric, sanitizeRule } from '@/lib/screener/colorRules';
import type { ColorRule, ColorRules } from '@/lib/screener/colorRules';
import DensityModal, { ColorInput, Field, NumberInput } from './DensityModal';

type Tab = 'edit' | 'all';
/** Metrics whose sign matters less than size (|−3%| colors like +3%) start with "compare |value|" on. */
const SIGNED = new Set(['change24h', 'funding']);
const UNIT_SUFFIX = { '%': '%', '$': '$', n: '', price: '', corr: '' } as const;

interface ColorRulesModalProps {
  onClose: () => void;
  /** Metric to open on (e.g. the column the user came from). */
  initialMetric?: string;
}

export default function ColorRulesModal({ onClose, initialMetric }: ColorRulesModalProps) {
  const saved = useColorRules();
  const [draft, setDraft] = useState<Record<string, ColorRule>>(() => ({ ...saved }));
  const [tab, setTab] = useState<Tab>('edit');
  const [key, setKey] = useState(() => initialMetric ?? Object.keys(saved)[0] ?? 'natr_5_14');
  const ids = useId();
  const metric = ruleMetric(key);
  const rule = draft[key];
  const count = Object.keys(draft).length;
  const tabs: ReadonlyArray<{ id: Tab; label: string }> = [{ id: 'edit', label: 'Edit rule' }, { id: 'all', label: `All rules (${count})` }];

  const put = (next: ColorRule | null) => setDraft((d) => {
    const out = { ...d };
    if (next && next.stops.length) out[key] = next; else delete out[key];
    return out;
  });
  const stops = rule?.stops ?? [];
  const setStop = (i: number, patch: Partial<ColorRule['stops'][number]>) =>
    put({ ...rule, stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addStop = () => {
    const last = stops.at(-1);
    put({ ...(rule ?? (SIGNED.has(key) ? { abs: true } : {})), stops: [...stops, last ? { min: last.min * 2 || 1, color: '#B48CFF' } : { ...DEFAULT_STOPS[0] }] });
  };
  const save = () => {
    const clean: Record<string, ColorRule> = {};
    for (const [k, r] of Object.entries(draft)) { const s = sanitizeRule(r); if (s) clean[k] = s; }
    colorRuleStore.set(clean);
    onClose();
  };

  // Preview: a few sample values spanning the rule's breakpoints.
  const samples = (() => {
    const mins = [...stops.map((s) => s.min)].sort((a, b) => a - b);
    if (!mins.length) return [];
    const lo = mins[0], hi = mins[mins.length - 1];
    const vals = [lo / 2, ...mins.map((m) => m * 1.1 || 0.1), hi * 2];
    return [...new Set(vals.map((v) => +v.toPrecision(3)))];
  })();
  const preview: ColorRules = rule ? { [key]: { ...rule, stops: [...stops].sort((a, b) => a.min - b.min) } } : {};

  const footer = (
    <>
      <button type="button" className={GHOST_BTN} onClick={() => setDraft({})} disabled={!count}>Clear all</button>
      <button type="button" className={`${GHOST_BTN} ml-auto`} onClick={onClose}>Cancel</button>
      <button type="button" className={PRIMARY_BTN} onClick={save} data-save-rules>Save</button>
    </>
  );

  return (
    <DensityModal title="Color rules" icon={<Palette size={16} />} tabs={tabs} tab={tab} onTab={setTab} onClose={onClose} footer={footer}>
      {tab === 'edit' && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_200px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Metric" hint="Colors its values in the Market Review list and in chart-card headers">
              <select id={`${ids}-metric`} className={INPUT} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Metric" data-rule-metric>
                {RULE_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.title}>
                    {g.metrics.map((m) => <option key={m.key} value={m.key}>{m.name}{draft[m.key] ? ' ●' : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <section className="flex flex-col gap-2" aria-label="Breakpoints">
              <div className="flex items-center gap-2">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-sx-muted">Breakpoints</h3>
                <span className="text-[11px] text-sx-muted">a value takes the color of the highest one it reaches</span>
              </div>
              {stops.length === 0 && <p className="m-0 text-[13px] text-sx-muted">No rule for {metric?.name ?? key} — values keep their default colors.</p>}
              {stops.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3" data-stop={i}>
                  <Field label={i === 0 ? 'From' : `Then from`}>
                    <NumberInput label={`Breakpoint ${i + 1}`} value={s.min} step={metric?.unit === '$' ? 100_000 : metric?.unit === 'n' ? 100 : 0.1} suffix={metric ? UNIT_SUFFIX[metric.unit] || undefined : undefined} onChange={(min) => setStop(i, { min })} />
                  </Field>
                  <Field label="Color">
                    <ColorInput label={`Breakpoint ${i + 1} color`} value={s.color} onChange={(color) => setStop(i, { color })} />
                  </Field>
                  <button type="button" className={`${ICON_BTN} mb-1 text-rose-400`} aria-label={`Remove breakpoint ${i + 1}`} onClick={() => put({ ...rule, stops: stops.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={`${GHOST_BTN} px-3 py-1 text-xs`} onClick={addStop} disabled={stops.length >= 8} data-add-stop>
                  <Plus size={13} aria-hidden="true" />Add breakpoint
                </button>
                {stops.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-sx-muted">
                    <input type="checkbox" className="m-0 accent-[#30A46C]" checked={rule?.abs === true} onChange={(e) => put({ ...rule, stops, abs: e.target.checked || undefined })} />
                    Compare |value| (−3% colors like +3%)
                  </label>
                )}
              </div>
            </section>
          </div>
          <div className="flex flex-col gap-1.5" aria-label="Preview">
            <span className="text-xs font-semibold text-sx-muted">Preview</span>
            <div className="flex flex-col gap-1 rounded-xl border border-solid border-sx-line bg-[#0D0E11] p-2.5 text-xs" data-preview>
              {samples.length === 0 && <span className="text-sx-muted">Add a breakpoint to preview.</span>}
              {samples.map((v) => (
                <div key={v} className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span className="text-[10px] uppercase tracking-wide text-sx-muted">{metric?.name ?? key}</span>
                  <span className="font-semibold" style={{ color: ruleColor(preview, key, v) ?? '#EDEEF0' }}>{fmtRuleValue(key, v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === 'all' && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Color rules">
          {count === 0 && <li className="text-[13px] text-sx-muted">No color rules yet. Pick a metric on “Edit rule” and add a breakpoint.</li>}
          {Object.entries(draft).map(([k, r]) => (
            <li key={k} className="flex items-center gap-2 rounded-lg border border-solid border-sx-line px-3 py-2" data-rule={k}>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{ruleMetric(k)?.name ?? k}{r.abs ? <span className="font-normal text-sx-muted"> · |value|</span> : null}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {r.stops.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] tabular-nums">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />≥ {fmtRuleValue(k, s.min)}
                  </span>
                ))}
              </span>
              <button type="button" className={`${GHOST_BTN} px-3 py-1 text-xs`} onClick={() => { setKey(k); setTab('edit'); }}>Edit</button>
              <button type="button" className={`${ICON_BTN} text-rose-400`} aria-label={`Delete rule for ${ruleMetric(k)?.name ?? k}`} onClick={() => setDraft((d) => { const o = { ...d }; delete o[k]; return o; })}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </DensityModal>
  );
}

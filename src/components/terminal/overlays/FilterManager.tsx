'use client';

/**
 * Screener filter manager: the list of saved filters (Exchange, Market, Sort,
 * Mode, Description, Edit / Delete) and the builder for creating or editing one.
 */
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FunnelPlus, Palette, Pencil, Plus, Trash2, X } from 'lucide-react';
import { BTN_RESET, GHOST_BTN, ICON_BTN, PRIMARY_BTN } from '@/components/chart/styles';
import type { MarketType } from '@/lib/alerts/alertStore';
import { ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import type { Asset, ExchangeId } from '@/lib/market/types';
import { describeFilter, sortLabel } from '@/lib/screener/filters';
import type { ScreenerFilter } from '@/lib/screener/filters';
import FilterBuilder from './FilterBuilder';
import ModeSwitch from './ModeSwitch';

interface FilterManagerProps {
  filters: readonly ScreenerFilter[];
  market: Asset[];
  primary: ExchangeId;
  marketType: MarketType;
  onSave: (f: ScreenerFilter) => void;
  onToggle: (f: ScreenerFilter, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Opens the metric color rules (shown as "Colors…" next to New filter). */
  onColors?: () => void;
}

type View = { kind: 'list' } | { kind: 'edit'; filter: ScreenerFilter | null };

const COLS = 'grid grid-cols-[minmax(110px,1.1fr)_84px_70px_minmax(110px,1fr)_52px_minmax(160px,2fr)_68px] items-center gap-3';

export default function FilterManager({ filters, market, primary, marketType, onSave, onToggle, onDelete, onClose, onColors }: FilterManagerProps) {
  const ids = useId();
  const [view, setView] = useState<View>(() => (filters.length ? { kind: 'list' } : { kind: 'edit', filter: null }));
  const [confirm, setConfirm] = useState<string | null>(null);

  // Esc steps back from the builder, then closes; it never reaches the terminal underneath.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (view.kind === 'edit' && filters.length) setView({ kind: 'list' });
    else onClose();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const editing = view.kind === 'edit';
  const title = editing ? (view.filter ? `Edit “${view.filter.name}”` : 'New filter') : 'Filters';

  return createPortal(
    <div className="fixed inset-0 z-[115] grid place-items-center p-4 text-sx-text [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label="Close filters" onClick={onClose} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3.5">
          {editing && filters.length > 0 && (
            <button type="button" onClick={() => setView({ kind: 'list' })} aria-label="Back to filters" className={ICON_BTN}>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          )}
          <FunnelPlus size={16} className="text-sx-muted" aria-hidden="true" />
          <h2 id={`${ids}-title`} className="m-0 truncate text-[15px] font-semibold">{title}</h2>
          {!editing && onColors && (
            <button type="button" onClick={onColors} className={`${GHOST_BTN} ml-auto gap-1.5 px-3 py-1.5 text-xs`} data-open-colors>
              <Palette size={14} aria-hidden="true" />Colors…
            </button>
          )}
          {!editing && (
            <button type="button" onClick={() => setView({ kind: 'edit', filter: null })} className={`${PRIMARY_BTN} ${onColors ? '' : 'ml-auto'} gap-1.5 px-3 py-1.5 text-xs`}>
              <Plus size={14} aria-hidden="true" />New filter
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className={`${ICON_BTN} ${editing ? 'ml-auto' : ''}`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {editing ? (
          <FilterBuilder
            key={view.filter?.id ?? 'new'}
            initial={view.filter}
            defaults={{ exchange: primary, market: marketType }}
            market={market}
            primary={primary}
            onSave={(f) => { onSave(f); setView({ kind: 'list' }); }}
            onCancel={() => (filters.length ? setView({ kind: 'list' }) : onClose())}
          />
        ) : (
          <div className="sx-scroll min-h-0 flex-1 overflow-auto px-3 pb-3">
            <div className="min-w-[760px]">
              <div className={`${COLS} sticky top-0 bg-[#111215] px-2 py-2.5 text-[10px] uppercase tracking-wide text-sx-muted`}>
                <span>Name</span><span>Exchange</span><span>Market</span><span>Sort</span><span>Mode</span><span>Description</span><span className="sr-only">Actions</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Saved filters">
                {filters.map((f) => (
                  <li key={f.id} className={`${COLS} rounded-lg px-2 py-2 text-xs ${f.enabled ? 'bg-sx-up/[0.06]' : 'hover:bg-white/[0.03]'}`}>
                    <span className="truncate text-[13px] font-semibold" title={f.name}>{f.name}</span>
                    <ExchangeLabel id={f.exchange} size={13} />
                    <span className="text-sx-muted">{f.market === 'futures' ? 'Futures' : 'Spot'}</span>
                    <span className="truncate text-sx-muted" title={sortLabel(f)}>{sortLabel(f)}</span>
                    <ModeSwitch checked={f.enabled} onChange={(v) => onToggle(f, v)} label={`${f.name}: ${f.enabled ? 'enabled' : 'disabled'}`} />
                    <span className="line-clamp-2 text-sx-muted" title={describeFilter(f)}>{describeFilter(f)}</span>
                    <span className="flex justify-end gap-1">
                      {confirm === f.id ? (
                        <button type="button" onClick={() => { onDelete(f.id); setConfirm(null); }} onBlur={() => setConfirm(null)} autoFocus className={`${BTN_RESET} rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/25`}>
                          Delete?
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => setView({ kind: 'edit', filter: f })} aria-label={`Edit ${f.name}`} title="Edit" className={`${ICON_BTN} text-sky-400 hover:bg-sky-400/10 hover:text-sky-300`}>
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setConfirm(f.id)} aria-label={`Delete ${f.name}`} title="Delete" className={`${ICON_BTN} text-rose-400 hover:bg-rose-400/10 hover:text-rose-300`}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {filters.length === 0 && <div className="px-2 py-10 text-center text-sm text-sx-muted">No filters yet — create one to screen the Market Map and the Market Review list.</div>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

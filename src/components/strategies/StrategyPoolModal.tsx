'use client';

/** Strategy Pool: browse the engine's algorithms and subscribe ("+ Add") — each becomes a workspace tab. */
import { Layers, Plus } from 'lucide-react';
import { PRIMARY_BTN } from '@/components/chart/styles';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { STRATEGIES, tfLabel } from '@/lib/strategies/catalog';
import { addWorkspace } from '@/lib/strategies/store';
import type { Workspace } from '@/lib/strategies/store';
import { closePool, selectStrategyTab } from '@/lib/strategies/ui';
import Modal from './Modal';

export default function StrategyPoolModal({ workspaces, primary }: { workspaces: readonly Workspace[]; primary: ExchangeId }) {
  const add = (id: (typeof STRATEGIES)[number]['id']) => {
    const uid = addWorkspace(id, primary);
    closePool();
    selectStrategyTab(uid);
  };
  return (
    <Modal title="Strategy Pool" icon={<Layers size={16} className="text-sx-muted" aria-hidden="true" />} onClose={closePool} data="strategy-pool">
      <div className="sx-scroll flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5 py-4">
        <p className="m-0 text-xs text-sx-muted">
          Automated algorithms that scan every liquid coin (24h volume ≥ $1M) in the background. Adding one creates a workspace on {ADAPTERS[primary].name} — change the exchange and filters in its Settings.
        </p>
        {STRATEGIES.map((s) => {
          const added = workspaces.filter((w) => w.strategy === s.id).length;
          return (
            <article key={s.id} className="flex flex-col gap-2 rounded-xl border border-solid border-sx-line bg-white/[0.02] p-3.5 sm:flex-row sm:items-start" data-pool-item={s.id}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="m-0 flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                  {s.name}
                  <span className="rounded bg-white/[0.07] px-1.5 py-px text-[10px] font-bold text-sx-muted" title="Candles the detector runs on">{tfLabel(s)}</span>
                  <span className="rounded bg-white/[0.07] px-1.5 py-px text-[10px] font-bold text-sx-muted" title="Directions it trades">{s.dirs.length === 2 ? 'Long & Short' : s.dirs[0] === 'LONG' ? 'Long only' : 'Short only'}</span>
                  {added > 0 && <span className="rounded bg-sx-up/15 px-1.5 py-px text-[10px] font-bold text-sx-up" data-added={added}>Added{added > 1 ? ` ×${added}` : ''}</span>}
                </h3>
                <p className="m-0 text-[12px] leading-relaxed text-sx-muted">{s.description}</p>
                <p className="m-0 text-[11px] leading-relaxed text-[#6B6E78]">{s.levels}</p>
              </div>
              <button type="button" className={`${PRIMARY_BTN} shrink-0`} style={{ padding: '6px 12px' }} onClick={() => add(s.id)} aria-label={`Add ${s.name}`}>
                <Plus size={14} className="mr-1" aria-hidden="true" />Add
              </button>
            </article>
          );
        })}
      </div>
    </Modal>
  );
}

'use client';

/** Alerts dashboard: In work / Archived, filtered by type, with edit / archive / restore / delete and recent firings. */
import { Archive, Bell, BellRing, MessageCircle, Monitor, Pencil, Plus, RotateCcw, Smartphone, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { archiveAlert, deleteAlert, restoreAlert } from '@/app/actions/alerts';
import { BTN_RESET, ICON_BTN, PRIMARY_BTN } from '@/components/chart/styles';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import Modal from '@/components/strategies/Modal';
import { SegmentedGroup } from '@/components/terminal/MarketControls';
import { alertsClient, markRead, removeLocal, upsertLocal } from '@/lib/alerts/client';
import type { AlertView } from '@/lib/alerts/client';
import { closeAlerts, openAlertWizard } from '@/lib/alerts/alertsUi';
import { describeAlert, marketOfExchange, MAX_ACTIVE_ALERTS } from '@/lib/alerts/types';
import { fmtDateTime } from '@/lib/format';
import { ADAPTERS } from '@/lib/market/exchanges';

type Tab = 'active' | 'archived';
type Filter = 'all' | 'price' | 'complex';
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'price', label: 'Price alert' }, { id: 'complex', label: 'Complex alert' }];

function Channels({ a }: { a: AlertView }) {
  const icons = [
    a.channels.browser && <Monitor key="b" size={13} aria-label="Browser notification" />,
    a.channels.telegram && <MessageCircle key="t" size={13} aria-label="Telegram" />,
    a.channels.push && <Smartphone key="p" size={13} aria-label="Push notification" />,
    a.sound !== 'off' && <Volume2 key="s" size={13} aria-label={a.sound === 'voice' ? 'Voice' : 'Sound'} />,
  ].filter(Boolean);
  return <span className="flex items-center gap-1.5 text-sx-muted" data-channels>{icons.length ? icons : <span className="text-[11px]">In app only</span>}</span>;
}

export default function AlertsDashboard() {
  const s = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  const [tab, setTab] = useState<Tab>('active');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  useEffect(() => { markRead(); }, [s.events.length]);

  const counts = useMemo(() => ({ active: s.alerts.filter((a) => a.status === 'active').length, archived: s.alerts.filter((a) => a.status === 'archived').length }), [s.alerts]);
  const rows = s.alerts.filter((a) => a.status === tab && (filter === 'all' || a.kind === filter));
  const act = (fn: () => Promise<{ ok: true; data: AlertView | true } | { ok: false; error: string }>, id: string, removed = false) => start(async () => {
    setError(null);
    const r = await fn().catch(() => ({ ok: false as const, error: 'Couldn’t reach the server. Try again.' }));
    if (!r.ok) { setError(r.error); return; }
    if (removed) removeLocal(id); else if (r.data !== true) upsertLocal(r.data);
  });

  return (
    <Modal title="Alerts" icon={<Bell size={16} aria-hidden="true" />} onClose={closeAlerts} maxWidth={980} height="min(760px, calc(100vh - 24px))" data="alerts-dashboard"
      footer={<>
        <span className="text-[11px] text-sx-muted">{counts.active} / {MAX_ACTIVE_ALERTS} active · checked on the server every few seconds, even with this tab closed</span>
        <button type="button" className={`${PRIMARY_BTN} ml-auto gap-1.5`} onClick={() => openAlertWizard({ mode: 'create' })} data-create-alert><Plus size={14} aria-hidden="true" />Create alert</button>
      </>}
    >
      <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-sx-line px-5 py-3">
        <div className="flex gap-1" role="tablist" aria-label="Alert lists">
          {(['active', 'archived'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} data-alerts-tab={t} onClick={() => setTab(t)}
              className={`${BTN_RESET} rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === t ? 'bg-white/[0.08] text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}>
              {t === 'active' ? 'In work' : 'Archived'} <span className="ml-1 text-[11px] text-sx-muted">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto"><SegmentedGroup label="Alert type" options={FILTERS} value={filter} onChange={setFilter} /></div>
      </div>
      {error && <div role="alert" className="mx-5 mt-3 rounded-lg border border-solid border-sx-down/40 bg-sx-down/10 px-3 py-2 text-xs text-[#F4B3B5]">{error}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 overflow-auto px-3 py-2" data-alert-list={tab}>
          {!s.loaded ? <p className="px-2 text-sm text-sx-muted">Loading…</p> : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-sx-muted">
              <BellRing size={28} aria-hidden="true" />
              {tab === 'active' ? 'No alerts in work. Create one, or click a price on any chart.' : 'Nothing archived yet. One-time alerts move here after they fire.'}
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {rows.map((a) => (
                <li key={a.id} data-alert-row={a.id} data-kind={a.kind} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-solid border-sx-line bg-white/[0.02] px-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <ExchangeIcon id={a.exchange} size={15} />
                      <span className="font-bold">{a.symbol}</span>
                      <span className="text-[11px] text-sx-muted">{ADAPTERS[a.exchange].name} · {marketOfExchange(a.exchange) === 'futures' ? 'Futures' : 'Spot'}</span>
                      <span className={`rounded px-1.5 py-px text-[10px] font-bold ${a.kind === 'price' ? 'bg-sx-alert/15 text-sx-alert' : 'bg-[#7CB7FF]/15 text-[#7CB7FF]'}`}>{a.kind === 'price' ? 'Price' : 'Complex'}</span>
                    </span>
                    <span className="truncate text-[13px]" data-alert-text>{describeAlert(a)}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sx-muted">
                      <Channels a={a} />
                      <span>{a.mode === 'once' ? 'One-time' : `Infinite · every ${a.repeatMinutes}m`}</span>
                      <span>Created {fmtDateTime(a.createdAt)}</span>
                      {a.triggerCount > 0 && <span data-trigger-count>Fired {a.triggerCount}× · last {a.lastTriggeredAt ? fmtDateTime(a.lastTriggeredAt) : '—'}</span>}
                      {a.status === 'archived' && <span>{a.archivedReason === 'fired' ? 'Fired' : 'Archived by you'}</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className={ICON_BTN} title="Edit" aria-label={`Edit ${a.symbol} alert`} onClick={() => openAlertWizard({ mode: 'edit', alert: a })} data-alert-edit><Pencil size={14} /></button>
                    {a.status === 'active'
                      ? <button type="button" className={ICON_BTN} title="Archive" aria-label={`Archive ${a.symbol} alert`} disabled={busy} onClick={() => act(() => archiveAlert(a.id), a.id)} data-alert-archive><Archive size={14} /></button>
                      : <button type="button" className={ICON_BTN} title="Restore" aria-label={`Restore ${a.symbol} alert`} disabled={busy} onClick={() => act(() => restoreAlert(a.id), a.id)} data-alert-restore><RotateCcw size={14} /></button>}
                    <button type="button" className={`${ICON_BTN} hover:text-sx-down`} title="Delete" aria-label={`Delete ${a.symbol} alert`} disabled={busy} onClick={() => act(() => deleteAlert(a.id), a.id, true)} data-alert-delete><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="min-h-0 overflow-auto border-0 border-t border-solid border-sx-line px-4 py-3 lg:border-l lg:border-t-0" aria-label="Recent triggers" data-recent-triggers>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sx-muted">Recent triggers</div>
          {s.events.length === 0 ? <p className="m-0 text-xs text-sx-muted">Nothing has fired yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {s.events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 rounded-lg bg-white/[0.03] px-2.5 py-2 text-xs" data-event={e.alertId}>
                  <span className="flex items-center gap-1.5 font-bold"><ExchangeIcon id={e.exchange} size={12} />{e.symbol}<span className="ml-auto font-normal text-sx-muted">{fmtDateTime(e.at)}</span></span>
                  <span className="text-sx-muted">{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Modal>
  );
}

'use client';

/**
 * Alerts dashboard: every alert with its status (Active / Paused / Triggered), pause / resume,
 * re-arm, edit and delete; the Telegram connection; and the recent firings with where each was sent.
 */
import { Bell, BellRing, MessageCircle, Monitor, Pencil, Plus, RotateCcw, Smartphone, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import type { ReactNode } from 'react';
import { archiveAlert, deleteAlert, restoreAlert } from '@/app/actions/alerts';
import { BTN_BASE, BTN_RESET, GHOST_BTN, ICON_BTN, PRIMARY_BTN } from '@/components/chart/styles';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import TelegramIcon from '@/components/shared/brand/TelegramIcon';
import Modal from '@/components/strategies/Modal';
import { SegmentedGroup } from '@/components/terminal/MarketControls';
import { openAccount } from '@/lib/account/accountUi';
import { alertsClient, markRead, refreshAlerts, removeLocal, upsertLocal } from '@/lib/alerts/client';
import type { AlertView, EventView } from '@/lib/alerts/client';
import { closeAlerts, openAlertWizard } from '@/lib/alerts/alertsUi';
import { describeAlert, displayStatus, marketOfExchange, MAX_ACTIVE_ALERTS } from '@/lib/alerts/types';
import type { AlertDisplayStatus } from '@/lib/alerts/types';
import { fmtDateTime } from '@/lib/format';
import { ADAPTERS } from '@/lib/market/exchanges';
import { openTelegramLink } from '@/lib/telegram/client';
import { LANG_LABEL } from '@/lib/telegram/i18n';

type Tab = 'all' | AlertDisplayStatus;
type Filter = 'all' | 'price' | 'complex';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [{ id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'paused', label: 'Paused' }, { id: 'triggered', label: 'Triggered' }];
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'price', label: 'Price alert' }, { id: 'complex', label: 'Complex alert' }];
const EMPTY_TEXT: Record<Tab, string> = {
  all: 'No alerts yet. Create one, or click a price on any chart.',
  active: 'No active alerts. Create one, or resume a paused one.',
  paused: 'Nothing paused. Switch an alert off to pause it without losing it.',
  triggered: 'Nothing triggered yet. One-time alerts move here after they fire.',
};
const STATUS_STYLE: Record<AlertDisplayStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-sx-up/15 text-sx-up' },
  paused: { label: 'Paused', cls: 'bg-white/[0.08] text-sx-muted' },
  triggered: { label: 'Triggered', cls: 'bg-sx-alert/15 text-sx-alert' },
};
/** Telegram polling after "Connect": until linked, at most 2 minutes. */
const TG_WAIT_MS = 2 * 60_000;
const DELETE_CONFIRM_MS = 4_000;

function Channels({ a }: { a: AlertView }) {
  const icons = [
    a.channels.browser && <Monitor key="b" size={13} aria-label="Browser notification" />,
    a.channels.telegram && <MessageCircle key="t" size={13} aria-label="Telegram" />,
    a.channels.push && <Smartphone key="p" size={13} aria-label="Push notification" />,
    a.sound !== 'off' && <Volume2 key="s" size={13} aria-label={a.sound === 'voice' ? 'Voice' : 'Sound'} />,
  ].filter(Boolean);
  return <span className="flex items-center gap-1.5 text-sx-muted" data-channels>{icons.length ? icons : <span className="text-[11px]">In app only</span>}</span>;
}

/** On = watching, off = paused (the compact switch used across the terminal). */
function PauseSwitch({ a, busy, onToggle }: { a: AlertView; busy: boolean; onToggle: () => void }) {
  const on = a.status === 'active';
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`${a.symbol} alert ${on ? 'active — pause it' : 'paused — resume it'}`} title={on ? 'Pause' : 'Resume'} disabled={busy} onClick={onToggle} data-alert-toggle
      className={`${BTN_BASE} flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-40 ${on ? 'justify-end bg-sx-up' : 'justify-start bg-sx-line2'}`}>
      <span className="h-3 w-3 rounded-full bg-white" aria-hidden="true" />
    </button>
  );
}

/** Delete in two clicks: the first arms it for a few seconds. */
function DeleteButton({ a, busy, onDelete }: { a: AlertView; busy: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), DELETE_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <button type="button" className={`${BTN_RESET} h-7 shrink-0 rounded-md bg-sx-down/15 px-2 text-[11px] font-bold text-sx-down hover:bg-sx-down/25`} disabled={busy} onClick={onDelete} aria-label={`Confirm deleting the ${a.symbol} alert`} data-alert-delete-confirm>
        Delete?
      </button>
    );
  }
  return <button type="button" className={`${ICON_BTN} hover:text-sx-down`} title="Delete" aria-label={`Delete ${a.symbol} alert`} disabled={busy} onClick={() => setArmed(true)} data-alert-delete><Trash2 size={14} /></button>;
}

/** Where a firing went: Telegram sent / failed / not linked, push devices, browser. */
function Delivery({ e }: { e: EventView }) {
  const parts: ReactNode[] = [];
  const tag = (key: string, icon: ReactNode, text: string, tone: 'ok' | 'bad' | 'muted') => (
    <span key={key} data-delivery={key} data-tone={tone} className={`inline-flex items-center gap-1 ${tone === 'ok' ? 'text-sx-up' : tone === 'bad' ? 'text-sx-down' : 'text-sx-muted'}`}>{icon}{text}</span>
  );
  // No record yet (still sending — it streams in a moment later — or an older event): what was chosen, in grey.
  const d = e.delivery;
  if (e.channels.telegram) {
    const t = d?.telegram;
    parts.push(tag('telegram', <MessageCircle size={11} aria-hidden="true" />,
      t === 'failed' ? 'Telegram failed' : t === 'unlinked' ? 'Telegram not linked' : 'Telegram',
      t === 'sent' ? 'ok' : t === 'failed' || t === 'unlinked' ? 'bad' : 'muted'));
  }
  if (e.channels.push) {
    const n = d?.push;
    parts.push(tag('push', <Smartphone size={11} aria-hidden="true" />,
      n === undefined ? 'Push' : n > 0 ? `Push · ${n} device${n === 1 ? '' : 's'}` : 'Push · no devices',
      n === undefined ? 'muted' : n > 0 ? 'ok' : 'bad'));
  }
  if (e.channels.browser) parts.push(tag('browser', <Monitor size={11} aria-hidden="true" />, 'Browser', 'muted'));
  return parts.length ? <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]" data-event-delivery>{parts}</span> : <span className="text-[11px] text-sx-muted">In app only</span>;
}

/** Telegram connection at a glance; connect right here, manage (language, disconnect) in Account settings. */
function TelegramCard() {
  const { telegram } = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot).channels;
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Linked / language may have changed elsewhere (Account settings, the bot, another tab).
  useEffect(() => { void refreshAlerts(); }, []);
  useEffect(() => {
    if (!waiting || telegram.linked) return undefined;
    const until = Date.now() + TG_WAIT_MS;
    const t = setInterval(() => { if (Date.now() > until) setWaiting(false); else void refreshAlerts(); }, 3_000);
    return () => clearInterval(t);
  }, [waiting, telegram.linked]);
  const connect = () => {
    setError(null);
    void openTelegramLink().then((err) => { if (err) setError(err); else setWaiting(true); });
  };
  const who = telegram.username ? `@${telegram.username}` : telegram.name ?? 'Telegram user';
  return (
    <section className="mb-4 flex flex-col gap-2 rounded-xl border border-solid border-sx-line bg-white/[0.02] p-3" data-telegram-card data-connected={telegram.linked}>
      <div className="flex items-center gap-2.5">
        <TelegramIcon size={20} />
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold">Telegram</span>
          <span className="truncate text-[11px] text-sx-muted" data-telegram-card-status>
            {!telegram.configured ? 'Not available on this server'
              : telegram.linked ? <>Connected as <span className="text-sx-text">{who}</span> · {LANG_LABEL[telegram.lang ?? 'en']}</>
                : waiting ? 'Waiting for you to press Start…' : 'Not connected'}
          </span>
        </div>
      </div>
      {telegram.configured && (telegram.linked
        ? <button type="button" className={`${GHOST_BTN} px-3 py-1.5 text-xs`} onClick={() => { closeAlerts(); openAccount('linked'); }} data-telegram-manage>Language & disconnect</button>
        : <button type="button" className={`${PRIMARY_BTN} px-3 py-1.5 text-xs`} onClick={connect} data-telegram-card-connect>{waiting ? 'Open Telegram again' : 'Connect Telegram'}</button>)}
      {error && <span role="alert" className="text-[11px] text-sx-down">{error}</span>}
    </section>
  );
}

export default function AlertsDashboard() {
  const s = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  const [tab, setTab] = useState<Tab>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  useEffect(() => { markRead(); }, [s.events.length]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: s.alerts.length, active: 0, paused: 0, triggered: 0 };
    for (const a of s.alerts) c[displayStatus(a)]++;
    return c;
  }, [s.alerts]);
  const rows = s.alerts.filter((a) => (tab === 'all' || displayStatus(a) === tab) && (filter === 'all' || a.kind === filter));
  const act = (fn: () => Promise<{ ok: true; data: AlertView | true } | { ok: false; error: string }>, id: string, removed = false) => start(async () => {
    setError(null);
    const r = await fn().catch(() => ({ ok: false as const, error: 'Couldn’t reach the server. Try again.' }));
    if (!r.ok) { setError(r.error); return; }
    if (removed) removeLocal(id); else if (r.data !== true) upsertLocal(r.data);
  });

  return (
    <Modal title="Alerts" icon={<Bell size={16} aria-hidden="true" />} onClose={closeAlerts} maxWidth={1020} height="min(780px, calc(100vh - 24px))" data="alerts-dashboard"
      footer={<>
        <span className="text-[11px] text-sx-muted">{counts.active} / {MAX_ACTIVE_ALERTS} active · checked on the server every few seconds, even with this tab closed</span>
        <button type="button" className={`${PRIMARY_BTN} ml-auto gap-1.5`} onClick={() => openAlertWizard({ mode: 'create' })} data-create-alert><Plus size={14} aria-hidden="true" />Create alert</button>
      </>}
    >
      <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-sx-line px-5 py-3">
        <div className="flex gap-1" role="tablist" aria-label="Alert status">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-alerts-tab={t.id} onClick={() => setTab(t.id)}
              className={`${BTN_RESET} rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === t.id ? 'bg-white/[0.08] text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}>
              {t.label} <span className="ml-1 text-[11px] text-sx-muted" data-count>{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto"><SegmentedGroup label="Alert type" options={FILTERS} value={filter} onChange={setFilter} /></div>
      </div>
      {error && <div role="alert" className="mx-5 mt-3 rounded-lg border border-solid border-sx-down/40 bg-sx-down/10 px-3 py-2 text-xs text-[#F4B3B5]">{error}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto px-3 py-2" data-alert-list={tab}>
          {!s.loaded ? <p className="px-2 text-sm text-sx-muted">Loading…</p> : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-sx-muted">
              <BellRing size={28} aria-hidden="true" />
              {EMPTY_TEXT[tab]}
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {rows.map((a) => {
                const status = displayStatus(a);
                return (
                  <li key={a.id} data-alert-row={a.id} data-kind={a.kind} data-status={status} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-solid border-sx-line px-3 py-2.5 ${status === 'active' ? 'bg-white/[0.02]' : 'bg-transparent'}`}>
                    <div className={`flex min-w-0 flex-col gap-1 ${status === 'paused' ? 'opacity-70' : ''}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <ExchangeIcon id={a.exchange} size={15} />
                        <span className="font-bold">{a.symbol}</span>
                        <span className="text-[11px] text-sx-muted">{ADAPTERS[a.exchange].name} · {marketOfExchange(a.exchange) === 'futures' ? 'Futures' : 'Spot'}</span>
                        <span className={`rounded px-1.5 py-px text-[10px] font-bold ${a.kind === 'price' ? 'bg-sx-alert/15 text-sx-alert' : 'bg-[#7CB7FF]/15 text-[#7CB7FF]'}`}>{a.kind === 'price' ? 'Price' : 'Complex'}</span>
                        <span className={`ml-auto rounded-full px-2 py-px text-[10px] font-bold ${STATUS_STYLE[status].cls}`} data-alert-status={status}>{STATUS_STYLE[status].label}</span>
                      </span>
                      <span className="truncate text-[13px]" data-alert-text>{describeAlert(a)}</span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sx-muted">
                        <Channels a={a} />
                        <span>{a.mode === 'once' ? 'One-time' : `Infinite · every ${a.repeatMinutes}m`}</span>
                        <span>Created {fmtDateTime(a.createdAt)}</span>
                        {a.triggerCount > 0 && <span data-trigger-count>Fired {a.triggerCount}× · last {a.lastTriggeredAt ? fmtDateTime(a.lastTriggeredAt) : '—'}</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {status === 'triggered'
                        ? <button type="button" className={ICON_BTN} title="Re-arm" aria-label={`Re-arm ${a.symbol} alert`} disabled={busy} onClick={() => act(() => restoreAlert(a.id), a.id)} data-alert-rearm><RotateCcw size={14} /></button>
                        : <PauseSwitch a={a} busy={busy} onToggle={() => act(() => (a.status === 'active' ? archiveAlert(a.id) : restoreAlert(a.id)), a.id)} />}
                      <button type="button" className={ICON_BTN} title="Edit" aria-label={`Edit ${a.symbol} alert`} onClick={() => openAlertWizard({ mode: 'edit', alert: a })} data-alert-edit><Pencil size={14} /></button>
                      <DeleteButton a={a} busy={busy} onDelete={() => act(() => deleteAlert(a.id), a.id, true)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <aside className="min-h-0 overflow-auto border-0 border-t border-solid border-sx-line px-4 py-3 lg:border-l lg:border-t-0" aria-label="Telegram and recent triggers">
          <TelegramCard />
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sx-muted">Recent triggers</div>
          <div data-recent-triggers>
            {s.events.length === 0 ? <p className="m-0 text-xs text-sx-muted">Nothing has fired yet.</p> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {s.events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 rounded-lg bg-white/[0.03] px-2.5 py-2 text-xs" data-event={e.alertId}>
                    <span className="flex items-center gap-1.5 font-bold"><ExchangeIcon id={e.exchange} size={12} />{e.symbol}<span className="ml-auto font-normal text-sx-muted">{fmtDateTime(e.at)}</span></span>
                    <span className="text-sx-muted">{e.text}</span>
                    <Delivery e={e} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </Modal>
  );
}

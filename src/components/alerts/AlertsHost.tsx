'use client';

/**
 * Alerts in the terminal: keeps the account's alerts streaming in, reacts to firings (toast,
 * sound / voice, desktop notification) and mounts the dashboard and wizard when opened.
 */
import { BellRing, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { alertsUi, openAlerts } from '@/lib/alerts/alertsUi';
import { onAlertFired, startAlertsClient } from '@/lib/alerts/client';
import type { EventView } from '@/lib/alerts/client';
import { playSound, showNotification } from '@/lib/alerts/notify';
import { registerServiceWorker } from '@/lib/push/client';
import { BTN_RESET } from '@/components/chart/styles';
import AlertsDashboard from './AlertsDashboard';
import CreateAlertWizard from './CreateAlertWizard';

const TOAST_MS = 9_000;
const MAX_TOASTS = 4;

export default function AlertsHost() {
  const ui = useSyncExternalStore(alertsUi.subscribe, alertsUi.getSnapshot, alertsUi.getServerSnapshot);
  const [toasts, setToasts] = useState<EventView[]>([]);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    const stop = startAlertsClient();
    // The service worker shows notifications for this tab too (and receives web push).
    void registerServiceWorker();
    const off = onAlertFired((e) => {
      setToasts((t) => [e, ...t.filter((x) => x.id !== e.id)].slice(0, MAX_TOASTS));
      playSound(e.sound, e);
      if (e.channels.browser) void showNotification(e);
    });
    return () => { off(); stop(); };
  }, []);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => setToasts((list) => list.filter((x) => Date.now() - x.at < TOAST_MS)), 1_000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <>
      {ui.dashboard && <AlertsDashboard />}
      {ui.wizard && <CreateAlertWizard init={ui.wizard} />}
      {mounted && toasts.length > 0 && createPortal(
        <div className="pointer-events-none fixed right-4 top-16 z-[140] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" data-alert-toasts>
          {toasts.map((e) => (
            <div key={e.id} role="status" data-alert-toast={e.alertId} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-solid border-sx-alert/50 bg-[#1A1710]/95 px-3 py-2.5 text-xs text-sx-text shadow-lg shadow-black/50 backdrop-blur">
              <BellRing size={16} className="mt-0.5 shrink-0 text-sx-alert" aria-hidden="true" />
              <button type="button" className={`${BTN_RESET} flex min-w-0 flex-1 flex-col gap-0.5 text-left`} onClick={() => openAlerts()}>
                <span className="flex items-center gap-1.5 font-bold text-sx-alert"><ExchangeIcon id={e.exchange} size={13} />{e.symbol}</span>
                <span className="text-sx-text">{e.text}</span>
              </button>
              <button type="button" className={`${BTN_RESET} shrink-0 text-sx-muted hover:text-sx-text`} aria-label="Dismiss" onClick={() => setToasts((t) => t.filter((x) => x.id !== e.id))}><X size={14} /></button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

'use client';

/**
 * Bell toggle on a strategy setup (or a whole strategy): on → a strategy alert that notifies
 * (Telegram / push / browser) each time such a setup becomes active; lit while that alert is
 * active; off → the alert is deleted. Clicks don't reach the card / row underneath.
 */
import { Bell, BellRing } from 'lucide-react';
import { useState, useSyncExternalStore, useTransition } from 'react';
import { BTN_RESET } from '@/components/chart/styles';
import { alertsClient } from '@/lib/alerts/client';
import { findStrategyAlert, toggleStrategyAlert } from '@/lib/alerts/quick';
import type { StrategyTarget } from '@/lib/alerts/quick';
import { ANY_COIN } from '@/lib/alerts/types';
import { STRATEGY_BY_ID } from '@/lib/strategies/catalog';

export default function StrategyAlertButton({ target, forming = false }: { target: StrategyTarget; /** The setup is still forming (its own entry can trigger the alert). */ forming?: boolean }) {
  const s = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const on = findStrategyAlert(s.alerts, target) !== null;
  const name = target.strategy === 'all' ? 'strategy' : STRATEGY_BY_ID.get(target.strategy)?.name ?? target.strategy;
  const what = `${target.tf === 'any' ? '' : `${target.tf} `}${target.dir === 'any' ? '' : `${target.dir.toLowerCase()} `}${name} setup`;
  const where = target.symbol === ANY_COIN ? 'on any coin' : `on ${target.symbol}`;
  const title = error ?? (on
    ? `Alert on: notifies when a ${what} ${where} triggers. Click to turn it off.`
    : forming ? `Notify me when this setup triggers (and later ${what}s ${where}) — Telegram / push`
      : `Notify me when a ${what} ${where} triggers — Telegram / push`);

  const toggle = () => start(async () => {
    setError(null);
    const err = await toggleStrategyAlert(target);
    if (err) setError(err);
  });

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Turn off the alert for ${what}s ${where}` : `Alert me on ${what}s ${where}`}
      title={title}
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); toggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${BTN_RESET} grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-50 ${error ? 'text-sx-down' : on ? 'bg-sx-alert/15 text-sx-alert' : 'text-sx-muted hover:bg-white/[0.06] hover:text-sx-text'}`}
      data-strategy-alert={on ? 'on' : 'off'}
    >
      {on ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
    </button>
  );
}

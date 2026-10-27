/**
 * Delivery of a fired alert beyond the open terminals (which get it from the event stream):
 * Telegram (when linked and chosen) and web push (when subscribed and chosen), both worded in
 * the account's language (`lang`, picked in the bot; English until then). Server-only.
 */
import { findById } from '@/lib/auth/users';
import { sendPush } from '@/lib/push/server';
import { sendTelegram } from '@/lib/telegram/bot';
import { telegramAlert, triggerText, venueText } from '@/lib/telegram/i18n';
import type { AlertDelivery, AlertEvent } from '../types';

const appUrl = () => process.env.AUTH_URL?.trim().replace(/\/+$/, '') || '';

/** Send to the chosen channels; resolves to where it went (for the dashboard's history). */
export async function deliver(e: AlertEvent): Promise<AlertDelivery> {
  const user = findById(e.userId);
  if (!user) return {};
  const lang = user.lang ?? 'en';
  const [telegram, push] = await Promise.all([
    !e.channels.telegram ? undefined
      : !user.telegram ? 'unlinked' as const
        : sendTelegram(user.telegram.id, telegramAlert(e, lang, appUrl())).then((ok) => (ok ? 'sent' as const : 'failed' as const), () => 'failed' as const),
    !e.channels.push ? undefined
      : sendPush(e.userId, { title: `${e.symbol} · ${venueText(e.exchange, lang)}`, body: triggerText(e, lang), tag: `alert-${e.alertId}`, url: '/terminal' }).catch(() => 0),
  ]);
  return { ...(telegram ? { telegram } : {}), ...(push !== undefined ? { push } : {}) };
}

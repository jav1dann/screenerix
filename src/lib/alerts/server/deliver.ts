/**
 * Delivery of a fired alert beyond the open terminals (which get it from the event stream):
 * Telegram (when linked and chosen) and web push (when subscribed and chosen), both worded in
 * the account's language (`lang`, picked in the bot; English until then). Server-only.
 */
import { findById } from '@/lib/auth/users';
import { sendPush } from '@/lib/push/server';
import { sendTelegram } from '@/lib/telegram/bot';
import { telegramAlert, triggerText, venueText } from '@/lib/telegram/i18n';
import type { AlertEvent } from '../types';

const appUrl = () => process.env.AUTH_URL?.trim().replace(/\/+$/, '') || '';

export async function deliver(e: AlertEvent): Promise<void> {
  const user = findById(e.userId);
  if (!user) return;
  const lang = user.lang ?? 'en';
  const jobs: Array<Promise<unknown>> = [];
  if (e.channels.telegram && user.telegram) {
    jobs.push(sendTelegram(user.telegram.id, telegramAlert(e, lang, appUrl())));
  }
  if (e.channels.push) {
    jobs.push(sendPush(e.userId, { title: `${e.symbol} · ${venueText(e.exchange, lang)}`, body: triggerText(e, lang), tag: `alert-${e.alertId}`, url: '/terminal' }));
  }
  await Promise.allSettled(jobs);
}

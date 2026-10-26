/**
 * Delivery of a fired alert beyond the open terminals (which get it from the event stream):
 * Telegram (when linked and chosen) and web push (when subscribed and chosen). Server-only.
 */
import { findById } from '@/lib/auth/users';
import { ADAPTERS } from '@/lib/market/exchanges';
import { sendPush } from '@/lib/push/server';
import { sendTelegram } from '@/lib/telegram/bot';
import type { AlertEvent } from '../types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const appUrl = () => process.env.AUTH_URL?.trim().replace(/\/+$/, '') || '';

export async function deliver(e: AlertEvent): Promise<void> {
  const user = findById(e.userId);
  if (!user) return;
  const venue = `${ADAPTERS[e.exchange].name} ${ADAPTERS[e.exchange].market === 'perp' ? 'Futures' : 'Spot'}`;
  const jobs: Array<Promise<unknown>> = [];
  if (e.channels.telegram && user.telegram) {
    const url = appUrl();
    jobs.push(sendTelegram(user.telegram.id, `🔔 <b>${esc(e.symbol)}</b> · ${esc(venue)}\n${esc(e.text)}${url ? `\n<a href="${esc(url)}/terminal">Open Screenerix</a>` : ''}`));
  }
  if (e.channels.push) {
    jobs.push(sendPush(e.userId, { title: `${e.symbol} · ${venue}`, body: e.text, tag: `alert-${e.alertId}`, url: '/terminal' }));
  }
  await Promise.allSettled(jobs);
}

/**
 * Screenerix Telegram bot (long polling — no public URL needed). Links Telegram accounts to
 * Screenerix accounts and delivers alerts.
 *
 *   Account screen → startLink(uid) → t.me/<bot>?start=<code> → user presses Start →
 *   the bot gets "/start <code>" → the account stores { id, username } → "Connected".
 *
 * `TELEGRAM_BOT_TOKEN` (from @BotFather) enables it; `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` names the
 * bot for links (else it's asked with getMe); `TELEGRAM_API_BASE` points it elsewhere
 * (tests). One process should poll a token at a time: a second poller gets 409 and pauses.
 * State lives on globalThis (server actions and the poller can sit in different bundles).
 * Server-only.
 */
import { randomBytes } from 'node:crypto';
import { findById, findByTelegramId, setTelegram } from '@/lib/auth/users';

const LINK_TTL_MS = 10 * 60_000;
const POLL_TIMEOUT_S = 50;
/** Telegram: ~30 messages/s overall, ~1/s per chat. */
const SEND_GAP_MS = 40;
const PER_CHAT_GAP_MS = 1_050;

interface Update { update_id: number; message?: { chat: { id: number; type: string }; from?: { id: number; username?: string; first_name?: string }; text?: string } }

interface BotState {
  username: string | null;
  polling: boolean;
  offset: number;
  stopped: boolean;
  codes: Map<string, { uid: string; exp: number }>;
  queue: Array<{ chatId: number; html: string; resolve: (ok: boolean) => void }>;
  sending: boolean;
  lastToChat: Map<number, number>;
}

const g = globalThis as typeof globalThis & { __sxTelegram?: BotState };
const fresh = (): BotState => ({ username: null, polling: false, offset: 0, stopped: false, codes: new Map(), queue: [], sending: false, lastToChat: new Map() });
const st = (g.__sxTelegram ??= fresh());

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
export const telegramConfigured = (): boolean => token().length > 0;
const api = (method: string) => `${(process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token()}/${method}`;

class TelegramError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(api(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  // The token is part of the URL: never log the URL, only the method and Telegram's description.
  if (!res.ok || !data?.ok) throw new TelegramError(res.status, `${method}: ${res.status} ${data?.description ?? ''}`.trim());
  return data.result as T;
}

/** `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` without a leading "@" (null when unset or not a valid bot name). */
export function configuredBotUsername(): string | null {
  const name = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z]\w{4,31}$/.test(name) ? name : null;
}

/** The bot's @username: from the env, else asked once with getMe. */
export async function botUsername(): Promise<string | null> {
  st.username ??= configuredBotUsername();
  if (st.username || !telegramConfigured()) return st.username;
  try {
    st.username = (await call<{ username: string }>('getMe', {})).username;
  } catch (e) {
    console.error(`[telegram] getMe failed: ${(e as Error).message}`);
  }
  return st.username;
}

/**
 * A one-time deep link that connects the bot to account `uid`: `t.me/<bot>?start=<token>`, where
 * the token is 96 random bits, valid 10 minutes, and replaces the account's previous one.
 */
export async function startLink(uid: string): Promise<{ url: string; expiresAt: number } | { error: string }> {
  if (!telegramConfigured()) return { error: 'Telegram isn’t configured on this server.' };
  const name = await botUsername();
  if (!name) return { error: 'The Telegram bot is unreachable right now. Try again shortly.' };
  const now = Date.now();
  for (const [c, v] of st.codes) if (v.exp < now || v.uid === uid) st.codes.delete(c);
  const code = randomBytes(12).toString('base64url');
  st.codes.set(code, { uid, exp: now + LINK_TTL_MS });
  return { url: `https://t.me/${name}?start=${code}`, expiresAt: now + LINK_TTL_MS };
}

/** Queue a message (HTML parse mode); resolves false when it couldn't be delivered. */
export function sendTelegram(chatId: number, html: string): Promise<boolean> {
  if (!telegramConfigured()) return Promise.resolve(false);
  return new Promise((resolve) => {
    st.queue.push({ chatId, html, resolve });
    void drain();
  });
}

async function drain(): Promise<void> {
  if (st.sending) return;
  st.sending = true;
  try {
    while (st.queue.length) {
      const item = st.queue.shift()!;
      const wait = (st.lastToChat.get(item.chatId) ?? 0) + PER_CHAT_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      st.lastToChat.set(item.chatId, Date.now());
      try {
        await call('sendMessage', { chat_id: item.chatId, text: item.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        item.resolve(true);
      } catch (e) {
        const err = e as TelegramError;
        // Blocked by the user / chat gone: the link is dead, so drop it.
        if (err.status === 403) {
          const u = findByTelegramId(item.chatId);
          if (u) { setTelegram(u.id, null); console.log(`[telegram] ${u.email} blocked the bot — unlinked`); }
        } else {
          console.error(`[telegram] send failed: ${err.message}`);
        }
        item.resolve(false);
      }
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }
  } finally {
    st.sending = false;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function onMessage(m: NonNullable<Update['message']>): Promise<void> {
  if (m.chat.type !== 'private' || !m.from) return;
  const text = (m.text ?? '').trim();
  const reply = (html: string) => sendTelegram(m.chat.id, html);
  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (start) {
    const code = start[1];
    if (!code) {
      await reply('Hi! To get Screenerix alerts here, open <b>Account settings → Linked accounts</b> in the terminal and press <b>Connect Telegram</b>.');
      return;
    }
    const entry = st.codes.get(code);
    st.codes.delete(code);
    const user = entry && entry.exp > Date.now() ? findById(entry.uid) : null;
    if (!user) {
      await reply('This link has expired. Press <b>Connect Telegram</b> in Screenerix again.');
      return;
    }
    setTelegram(user.id, { id: m.from.id, ...(m.from.username ? { username: m.from.username } : {}), ...(m.from.first_name ? { firstName: m.from.first_name } : {}), linkedAt: Date.now() });
    console.log(`[telegram] linked ${user.email} → ${m.from.id}`);
    await reply(`✅ Connected to Screenerix as <b>${esc(user.email)}</b>. Alerts with Telegram turned on will arrive here. Send /stop to disconnect.`);
    return;
  }
  if (/^\/stop(?:@\w+)?$/.test(text)) {
    const user = findByTelegramId(m.from.id);
    if (user) setTelegram(user.id, null);
    await reply(user ? 'Disconnected. You won’t get Screenerix alerts here any more.' : 'This Telegram account isn’t connected to Screenerix.');
    return;
  }
  const linked = findByTelegramId(m.from.id);
  await reply(linked
    ? `Connected as <b>${esc(linked.email)}</b>. Alerts arrive here automatically. /stop disconnects.`
    : 'Open Screenerix → <b>Account settings → Linked accounts</b> and press <b>Connect Telegram</b>.');
}

/** Start the long-polling loop once per process (no-op without a token). */
export function startTelegramBot(): void {
  if (!telegramConfigured() || st.polling) return;
  st.polling = true;
  void (async () => {
    await botUsername();
    let backoff = 1_000;
    while (!st.stopped) {
      try {
        const updates = await call<Update[]>('getUpdates', { offset: st.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] }, (POLL_TIMEOUT_S + 10) * 1000);
        backoff = 1_000;
        for (const u of updates) {
          st.offset = u.update_id + 1;
          if (u.message) await onMessage(u.message).catch((e) => console.error(`[telegram] update failed: ${(e as Error).message}`));
        }
      } catch (e) {
        const err = e as TelegramError;
        if (err.status === 409) console.error('[telegram] another process is polling this bot token — retrying in 60 s');
        else if (err.status === 401 || err.status === 404) { console.error('[telegram] TELEGRAM_BOT_TOKEN was rejected — bot stopped'); st.polling = false; return; }
        else console.error(`[telegram] polling: ${err.message}`);
        await new Promise((r) => setTimeout(r, err.status === 409 ? 60_000 : backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  })();
  console.log('[telegram] bot polling started');
}

/**
 * Screenerix Telegram bot (long polling — no public URL needed). Links Telegram accounts to
 * Screenerix accounts, asks for the notification language and delivers alerts.
 *
 *   Account screen → startLink(uid) → t.me/<bot>?start=<code> → user presses Start →
 *   the bot gets "/start <code>" → the account stores { id, username } → "Connected" →
 *   no language yet: an inline keyboard (🇦🇿 / 🇬🇧 / 🇷🇺) → the choice is saved on the account.
 *
 * `TELEGRAM_BOT_TOKEN` (from @BotFather) enables it; `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` names the
 * bot for links (else it's asked with getMe); `TELEGRAM_API_BASE` points it elsewhere
 * (tests). One process should poll a token at a time: a second poller gets 409 and pauses.
 * State lives on globalThis (server actions and the poller can sit in different bundles).
 * Server-only.
 */
import { randomBytes } from 'node:crypto';
import { findById, findByTelegramId, setLang, setTelegram } from '@/lib/auth/users';
import { guessLang, isLang, LANG_LABEL, LANGS, STRINGS } from './i18n';
import type { Lang } from './i18n';

const LINK_TTL_MS = 10 * 60_000;
const POLL_TIMEOUT_S = 50;
/** Telegram: ~30 messages/s overall, ~1/s per chat. */
const SEND_GAP_MS = 40;
const PER_CHAT_GAP_MS = 1_050;
/** Tries per message: flood control (429) and network / 5xx failures are retried. */
const MAX_TRIES = 4;
/** Languages remembered for chats that picked one before linking (carried over on link). */
const MAX_CHAT_LANGS = 10_000;

interface From { id: number; username?: string; first_name?: string; language_code?: string }
interface Chat { id: number; type: string }
interface Update {
  update_id: number;
  message?: { chat: Chat; from?: From; text?: string };
  callback_query?: { id: string; from: From; data?: string; message?: { message_id: number; chat: Chat } };
}
type Extra = Record<string, unknown>;

interface BotState {
  username: string | null;
  polling: boolean;
  offset: number;
  stopped: boolean;
  codes: Map<string, { uid: string; exp: number }>;
  queue: Array<{ chatId: number; html: string; extra?: Extra; resolve: (ok: boolean) => void }>;
  sending: boolean;
  lastToChat: Map<number, number>;
  chatLang: Map<number, Lang>;
}

const g = globalThis as typeof globalThis & { __sxTelegram?: BotState };
const fresh = (): BotState => ({ username: null, polling: false, offset: 0, stopped: false, codes: new Map(), queue: [], sending: false, lastToChat: new Map(), chatLang: new Map() });
const st = (g.__sxTelegram ??= fresh());
st.chatLang ??= new Map(); // state created by an older bundle (dev reloads)

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
export const telegramConfigured = (): boolean => token().length > 0;
const api = (method: string) => `${(process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${token()}/${method}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `status` 0: no HTTP answer (network / timeout). `retryAfter`: seconds, on 429. */
class TelegramError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter?: number) { super(message); }
}

async function call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(api(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new TelegramError(0, `${method}: ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null;
  // The token is part of the URL: never log the URL, only the method and Telegram's description.
  if (!res.ok || !data?.ok) throw new TelegramError(res.status, `${method}: ${res.status} ${data?.description ?? ''}`.trim(), data?.parameters?.retry_after);
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

/** Queue a message (HTML parse mode, optional extra sendMessage fields); resolves false when it couldn't be delivered. */
export function sendTelegram(chatId: number, html: string, extra?: Extra): Promise<boolean> {
  if (!telegramConfigured()) return Promise.resolve(false);
  return new Promise((resolve) => {
    st.queue.push({ chatId, html, extra, resolve });
    void drain();
  });
}

/** The chat is gone for good: blocked by the user, deleted, or the account deactivated. */
const isDeadChat = (e: TelegramError) => e.status === 403 || (e.status === 400 && /chat not found|user is deactivated/i.test(e.message));

/** Send one message, retrying flood control (after Telegram's retry_after) and transient failures. */
async function deliverOne(item: BotState['queue'][number]): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await call('sendMessage', { chat_id: item.chatId, text: item.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...item.extra });
      return true;
    } catch (e) {
      const err = e as TelegramError;
      if (isDeadChat(err)) {
        // The link is dead: drop it, so alerts stop trying this chat.
        const u = findByTelegramId(item.chatId);
        if (u) { setTelegram(u.id, null); console.log(`[telegram] ${u.email}: chat unreachable (${err.status}) — unlinked`); }
        st.chatLang.delete(item.chatId);
        return false;
      }
      const transient = err.status === 429 || err.status === 0 || err.status >= 500;
      if (!transient || attempt >= MAX_TRIES) {
        console.error(`[telegram] send failed: ${err.message}`);
        return false;
      }
      await sleep(err.status === 429 ? Math.min(60, err.retryAfter ?? 5) * 1000 : 1000 * 2 ** (attempt - 1));
    }
  }
}

async function drain(): Promise<void> {
  if (st.sending) return;
  st.sending = true;
  try {
    while (st.queue.length) {
      const item = st.queue.shift()!;
      const wait = (st.lastToChat.get(item.chatId) ?? 0) + PER_CHAT_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      st.lastToChat.set(item.chatId, Date.now());
      item.resolve(await deliverOne(item));
      await sleep(SEND_GAP_MS);
    }
  } finally {
    st.sending = false;
  }
}

/* ── Language ── */

/** The chat's chosen language: the linked account's, or one picked before linking (null: not chosen yet). */
function chosenLang(chatId: number, fromId: number): Lang | null {
  return findByTelegramId(fromId)?.lang ?? st.chatLang.get(chatId) ?? null;
}

function rememberChatLang(chatId: number, lang: Lang): void {
  st.chatLang.delete(chatId);
  st.chatLang.set(chatId, lang);
  if (st.chatLang.size > MAX_CHAT_LANGS) st.chatLang.delete(st.chatLang.keys().next().value!);
}

const LANG_KEYBOARD = { inline_keyboard: LANGS.map((l) => [{ text: LANG_LABEL[l], callback_data: `lang:${l}` }]) };

/** Ask for the language (the prompt is in the current / guessed one). */
const askLang = (chatId: number, lang: Lang) => sendTelegram(chatId, STRINGS[lang].choose, { reply_markup: LANG_KEYBOARD });

/** A language button: save it (on the account, or for the chat until it links) and confirm in place. */
async function onCallback(q: NonNullable<Update['callback_query']>): Promise<void> {
  const picked = q.data?.match(/^lang:(\w+)$/)?.[1];
  if (!isLang(picked)) { await call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {}); return; }
  const chatId = q.message?.chat.id ?? q.from.id;
  const user = findByTelegramId(q.from.id);
  if (user) setLang(user.id, picked);
  else rememberChatLang(chatId, picked);
  if (user) console.log(`[telegram] ${user.email}: language → ${picked}`);
  await call('answerCallbackQuery', { callback_query_id: q.id, text: LANG_LABEL[picked] }).catch(() => {});
  // Replace the keyboard message with the confirmation (a new message if it can't be edited).
  const edited = q.message
    ? await call('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: STRINGS[picked].saved, parse_mode: 'HTML' }).then(() => true, () => false)
    : false;
  if (!edited) await sendTelegram(chatId, STRINGS[picked].saved);
}

/* ── Messages ── */

async function onMessage(m: NonNullable<Update['message']>): Promise<void> {
  if (m.chat.type !== 'private' || !m.from) return;
  const from = m.from;
  const text = (m.text ?? '').trim();
  const chosen = chosenLang(m.chat.id, from.id);
  const lang = chosen ?? guessLang(from.language_code);
  const t = STRINGS[lang];
  const reply = (html: string) => sendTelegram(m.chat.id, html);

  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (start?.[1]) {
    const code = start[1];
    const entry = st.codes.get(code);
    st.codes.delete(code);
    const user = entry && entry.exp > Date.now() ? findById(entry.uid) : null;
    if (!user) { await reply(t.expired); return; }
    setTelegram(user.id, { id: from.id, ...(from.username ? { username: from.username } : {}), ...(from.first_name ? { firstName: from.first_name } : {}), linkedAt: Date.now() });
    console.log(`[telegram] linked ${user.email} → ${from.id}`);
    // A language picked before linking becomes the account's (unless it already has one).
    const pending = st.chatLang.get(m.chat.id);
    if (!user.lang && pending) setLang(user.id, pending);
    st.chatLang.delete(m.chat.id);
    const accountLang = user.lang ?? pending ?? null;
    await reply(STRINGS[accountLang ?? lang].linked(user.email));
    if (!accountLang) await askLang(m.chat.id, lang);
    return;
  }

  if (/^\/language(?:@\w+)?$/.test(text)) { await askLang(m.chat.id, lang); return; }

  if (/^\/stop(?:@\w+)?$/.test(text)) {
    const user = findByTelegramId(from.id);
    if (user) setTelegram(user.id, null);
    await reply(user ? t.stopped : t.notLinked);
    return;
  }

  // /start without a token, or anything else: where things stand (+ the language question once).
  const linked = findByTelegramId(from.id);
  await reply(linked ? t.status(linked.email) : t.hello);
  if (!chosen && start) await askLang(m.chat.id, lang);
}

/** The bot's command menu, in each language (English is the default for other clients). */
async function registerCommands(): Promise<void> {
  for (const l of LANGS) {
    const c = STRINGS[l].commands;
    const commands = [{ command: 'start', description: c.start }, { command: 'language', description: c.language }, { command: 'stop', description: c.stop }];
    await call('setMyCommands', { commands, ...(l === 'en' ? {} : { language_code: l }) })
      .catch((e) => console.error(`[telegram] setMyCommands (${l}) failed: ${(e as Error).message}`));
  }
}

/** Start the long-polling loop once per process (no-op without a token). */
export function startTelegramBot(): void {
  if (!telegramConfigured() || st.polling) return;
  st.polling = true;
  void (async () => {
    await botUsername();
    await registerCommands();
    let backoff = 1_000;
    while (!st.stopped) {
      try {
        const updates = await call<Update[]>('getUpdates', { offset: st.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] }, (POLL_TIMEOUT_S + 10) * 1000);
        backoff = 1_000;
        for (const u of updates) {
          st.offset = u.update_id + 1;
          const handled = u.message ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : null;
          await handled?.catch((e) => console.error(`[telegram] update failed: ${(e as Error).message}`));
        }
      } catch (e) {
        const err = e as TelegramError;
        if (err.status === 409) console.error('[telegram] another process is polling this bot token — retrying in 60 s');
        else if (err.status === 401 || err.status === 404) { console.error('[telegram] TELEGRAM_BOT_TOKEN was rejected — bot stopped'); st.polling = false; return; }
        else console.error(`[telegram] polling: ${err.message}`);
        await sleep(err.status === 409 ? 60_000 : backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  })();
  console.log('[telegram] bot polling started');
}

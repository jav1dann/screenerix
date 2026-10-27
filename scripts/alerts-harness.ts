/**
 * End-to-end checks of the server-side alert pipeline and the Telegram bot, with the app's real modules:
 *   bot: /start <token> linking, the language keyboard (inline buttons → account `lang`), /language, /stop
 *   alerts: startAlertWorker → rules → store (recordFire) → deliver → Telegram queue + web-push,
 *           worded in each account's language
 *   errors: flood control (429 → retry), dead chats (400 chat not found / 403 blocked → unlink)
 * Only the exchange price feed is faked. Telegram goes to the mock Bot API and push to a local
 * HTTPS push service that decrypts every message. Run through `npm run test:alerts`
 * (scripts/test-alerts.mjs sets up the environment); exits 1 on any failed check.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { eventsOf, findAlert, onUserAlerts, patchAlert, saveAlert } from '@/lib/alerts/server/store';
import type { AlertInput } from '@/lib/alerts/types';
import { createUser, findById, setTelegram, updateUser } from '@/lib/auth/users';
import { addSubscription } from '@/lib/push/server';
import { startAlertWorker } from '@/lib/server/scan/alertWorker';
import type { AlertCoin, MarketWorker } from '@/lib/server/scan/marketWorker';
import { startLink, startTelegramBot } from '@/lib/telegram/bot';
import { STRINGS } from '@/lib/telegram/i18n';

/** Web Push payload decryption (RFC 8188), from web-push's own dependency. */
const ece = createRequire(import.meta.url)('http_ece') as {
  decrypt(buf: Buffer, opts: { version: 'aes128gcm'; privateKey: ReturnType<typeof createECDH>; authSecret: Buffer }): Buffer;
};

const DIR = process.env.SX_TEST_DIR;
const TELEGRAM = process.env.TELEGRAM_API_BASE;
if (!DIR || !TELEGRAM || !process.env.SX_DATA_DIR) {
  console.error('Run this through `npm run test:alerts`.');
  process.exit(1);
}

const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ok: () => boolean | Promise<boolean>, ms = 8_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await ok()) return true;
  return false;
}

/* ── Mock Telegram helpers ── */

interface Call { method: string; chat_id?: number; text?: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }; language_code?: string; commands?: Array<{ command: string; description: string }> }
const calls = async (): Promise<Call[]> => (await fetch(`${TELEGRAM}/__calls`)).json() as Promise<Call[]>;
const sentTo = async (chat: number) => (await calls()).filter((c) => c.method === 'sendMessage' && c.chat_id === chat);
const update = (u: object) => fetch(`${TELEGRAM}/__update`, { method: 'POST', body: JSON.stringify(u) });
const say = (chat: number, text: string, languageCode = 'en', username?: string) =>
  update({ message: { chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Test', language_code: languageCode, ...(username ? { username } : {}) }, text } });
let cbId = 0;
const press = (chat: number, data: string) =>
  update({ callback_query: { id: `cb${++cbId}`, from: { id: chat }, data, message: { message_id: 100 + cbId, chat: { id: chat, type: 'private' } } } });
const tokenOf = async (uid: string) => {
  const r = await startLink(uid);
  if (!('url' in r)) throw new Error(r.error);
  return new URL(r.url).searchParams.get('start')!;
};

/* ── Local push service: records each message (decrypted); `/push/gone` answers 410 ── */

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const authSecret = randomBytes(16);
const pushes: Array<{ path: string; vapid: boolean; payload: Record<string, unknown> }> = [];
const pushServer = https.createServer({ key: readFileSync(`${DIR}/push-key.pem`), cert: readFileSync(`${DIR}/push-cert.pem`) }, (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/push/gone') { res.writeHead(410); res.end(); return; }
    const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ecdh, authSecret });
    pushes.push({ path: req.url ?? '', vapid: /^vapid t=.+, k=.+/.test(String(req.headers.authorization)), payload: JSON.parse(plain.toString()) });
    res.writeHead(201);
    res.end();
  });
});

/* ── Fake venue feed: the slice of MarketWorker the alert worker uses ── */

const coins = new Map<string, AlertCoin>();
let onPrices: (() => void) | null = null;
let hot: readonly string[] = [];
const market = {
  coin: (s: string) => coins.get(s) ?? null,
  onPrices: (l: () => void) => { onPrices = l; return () => { onPrices = null; }; },
  setHot: (s: readonly string[]) => { hot = s; },
} as unknown as MarketWorker;
const tick = (prices: Record<string, number>) => {
  for (const [s, price] of Object.entries(prices)) coins.set(s, { ...(coins.get(s) ?? { funding: null, k1m: null, k5m: null, oi5: null }), price });
  onPrices?.();
};

const BASE = { exchange: 'binance', sound: 'beep' } as const;
const ALL = { browser: true, telegram: true, push: true };
const NO_PUSH = { browser: true, telegram: true, push: false };
const priceAlert = (uid: string, symbol: string, level: number, channels = NO_PUSH) =>
  saveAlert(uid, { ...BASE, kind: 'price', symbol, price: { level, direction: 'above' }, channels, mode: 'once', repeatMinutes: 5 } as AlertInput);

async function botChecks(): Promise<{ amina: string; kamran: string }> {
  section('Telegram bot: linking & language');
  // Misconfigured on purpose: names another bot than the token's (the mock's getMe says sx_test_bot).
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = 'SomeOtherBot';
  startTelegramBot();
  check('bot registers its command menu in az / en / ru', await waitFor(async () => (await calls()).filter((c) => c.method === 'setMyCommands').length === 3)
    && (await calls()).some((c) => c.method === 'setMyCommands' && c.language_code === 'ru' && c.commands?.some((x) => x.command === 'language' && x.description === 'Сменить язык')));

  // Linking without a language yet: confirmation in the guessed language, then the keyboard.
  const amina = (await createUser({ email: 'amina@test.local', name: 'Amina', password: 'amina-pass-1' })).id;
  const link = await startLink(amina);
  check('username mismatch: links use the token’s real bot, not the misconfigured name', 'url' in link && link.url.startsWith('https://t.me/sx_test_bot?start='), 'url' in link ? link.url : link.error);
  await say(8001, `/start ${await tokenOf(amina)}`, 'az', 'amina_tg');
  await waitFor(async () => (await sentTo(8001)).length >= 2);
  const [linkedMsg, ask] = await sentTo(8001);
  check('/start <token> links the chat to the account', findById(amina)?.telegram?.id === 8001 && findById(amina)?.telegram?.username === 'amina_tg');
  check('confirmation in the guessed language (az from Telegram)', linkedMsg?.text === STRINGS.az.linked('amina@test.local'), linkedMsg?.text);
  const buttons = ask?.reply_markup?.inline_keyboard.flat() ?? [];
  check('no language yet → inline keyboard 🇦🇿 / 🇬🇧 / 🇷🇺', ask?.text === STRINGS.az.choose && buttons.map((b) => b.callback_data).join() === 'lang:az,lang:en,lang:ru', buttons.map((b) => b.text).join(' '));

  await press(8001, 'lang:ru');
  check('pressing 🇷🇺 saves ru on the account', await waitFor(() => findById(amina)?.lang === 'ru'));
  // Saved first, then answered and edited: wait for the edit rather than reading the calls right away.
  check('the keyboard message becomes the confirmation', await waitFor(async () => (await calls()).some((c) => c.method === 'editMessageText' && c.chat_id === 8001 && c.text === STRINGS.ru.saved)));
  check('the button press is answered', (await calls()).some((c) => c.method === 'answerCallbackQuery'));

  await press(8001, 'lang:xx');
  await sleep(500);
  check('an unknown button changes nothing', findById(amina)?.lang === 'ru');

  await say(8001, '/language', 'az');
  check('/language asks again, in the chosen language', await waitFor(async () => (await sentTo(8001)).some((m) => m.text === STRINGS.ru.choose && !!m.reply_markup)));
  await say(8001, '/start', 'az');
  check('/start with a language set: status, no keyboard', await waitFor(async () => (await sentTo(8001)).at(-1)?.text === STRINGS.ru.status('amina@test.local'))
    && (await sentTo(8001)).filter((m) => m.reply_markup).length === 2);

  // Picking a language before linking: it carries over to the account, without asking again.
  const kamran = (await createUser({ email: 'kamran@test.local', name: 'Kamran', password: 'kamran-pass-1' })).id;
  await say(8002, '/start', 'en');
  await waitFor(async () => (await sentTo(8002)).length >= 2);
  const [hello, ask2] = await sentTo(8002);
  check('unlinked /start: how to connect + the keyboard', hello?.text === STRINGS.en.hello && !!ask2?.reply_markup);
  await press(8002, 'lang:az');
  await waitFor(async () => (await calls()).some((c) => c.method === 'editMessageText' && c.chat_id === 8002));
  await say(8002, `/start ${await tokenOf(kamran)}`, 'en');
  await waitFor(async () => (await sentTo(8002)).length >= 3);
  const kamranMsgs = await sentTo(8002);
  check('a language picked before linking becomes the account’s', findById(kamran)?.lang === 'az' && kamranMsgs.at(-1)?.text === STRINGS.az.linked('kamran@test.local'));
  await sleep(1_500);
  check('…and isn’t asked again', (await sentTo(8002)).filter((m) => m.reply_markup).length === 1);

  await say(8003, '/start not-a-real-token', 'ru');
  check('unknown / used token: "expired", in the guessed language', await waitFor(async () => (await sentTo(8003)).at(-1)?.text === STRINGS.ru.expired));

  await say(8001, '/stop', 'az');
  check('/stop unlinks, replying in the account’s language', await waitFor(async () => !findById(amina)?.telegram && (await sentTo(8001)).at(-1)?.text === STRINGS.ru.stopped));
  check('…and the language stays on the account', findById(amina)?.lang === 'ru');
  setTelegram(amina, { id: 8001, username: 'amina_tg', linkedAt: Date.now() }); // relinked for the alert checks
  return { amina, kamran };
}

async function main(): Promise<void> {
  await new Promise<void>((r) => pushServer.listen(0, '127.0.0.1', r));
  const pushBase = `https://localhost:${(pushServer.address() as AddressInfo).port}`;
  const subKeys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };

  const { amina, kamran } = await botChecks();

  section('Alert worker & delivery');
  const user = await createUser({ email: 'trader@test.local', name: 'Trader', password: 'trader-pass-1' });
  setTelegram(user.id, { id: 9001, username: 'trader', linkedAt: Date.now() });
  addSubscription(user.id, { endpoint: `${pushBase}/push/device-1`, keys: subKeys });
  addSubscription(user.id, { endpoint: `${pushBase}/push/gone`, keys: subKeys });
  addSubscription(amina, { endpoint: `${pushBase}/push/amina`, keys: subKeys });
  const lapsed = await createUser({ email: 'lapsed@test.local', name: 'Lapsed', password: 'lapsed-pass-1' });
  updateUser(lapsed.id, { trialEndsAt: Date.now() - 1_000 });
  setTelegram(lapsed.id, { id: 9002, linkedAt: Date.now() });

  const streamed: string[] = [];
  onUserAlerts(user.id, (c) => { if (c.type === 'event') streamed.push(c.event.symbol); });

  const once = priceAlert(user.id, 'BTC', 100_000, ALL);
  const repeating = saveAlert(user.id, { ...BASE, kind: 'price', symbol: 'ETH', price: { level: 3_000, direction: 'below' }, channels: NO_PUSH, mode: 'infinite', repeatMinutes: 1 } as AlertInput);
  const complexCond = { metric: 'change', window: '1m', op: '>', value: 2 } as const;
  const complex = saveAlert(user.id, { ...BASE, kind: 'complex', symbol: 'SOL', conditions: [complexCond], channels: NO_PUSH, mode: 'once', repeatMinutes: 5 } as AlertInput);
  const lapsedAlert = priceAlert(lapsed.id, 'BTC', 1, ALL);
  priceAlert(amina, 'BTC', 100_000, ALL); // ru
  saveAlert(kamran, { ...BASE, kind: 'complex', symbol: 'SOL', conditions: [complexCond], channels: NO_PUSH, mode: 'once', repeatMinutes: 5 } as AlertInput); // az

  const worker = startAlertWorker('binance', market);
  // SOL closed at 100 in the last full minutes → the "1m ago" reference price is 100.
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const bar = (t: number) => ({ t, o: 100, h: 100, l: 100, c: 100, v: 1 });
  coins.set('SOL', { price: 100, funding: null, k5m: null, oi5: null, k1m: [bar(minute - 180_000), bar(minute - 120_000)] });

  tick({ BTC: 99_000, ETH: 3_100, SOL: 101 });
  check('below the levels: nothing fires', eventsOf(user.id).length === 0);
  check('complex alert marks its coin hot (fresh 1m candles)', hot.includes('SOL'), JSON.stringify(hot));

  tick({ BTC: 100_500, ETH: 2_990, SOL: 103 });
  const fired = eventsOf(user.id);
  const textOf = (id: string) => fired.find((e) => e.alertId === id)?.text ?? '';
  check('price alert fires on crossing (once, above)', textOf(once.id) !== '', textOf(once.id));
  check('infinite price alert fires (below)', textOf(repeating.id) !== '');
  check('complex alert fires (1m change > 2%)', textOf(complex.id) !== '', textOf(complex.id));
  check('events carry the structured trigger (for localized messages)', fired.find((e) => e.alertId === once.id)?.detail?.kind === 'price');
  check('one-time alert is archived after firing', findAlert(once.id)?.status === 'archived' && findAlert(once.id)?.archivedReason === 'fired');
  check('account without access is skipped', eventsOf(lapsed.id).length === 0 && findAlert(lapsedAlert.id)?.status === 'active');
  check('open terminals get the events (stream emitter)', ['BTC', 'ETH', 'SOL'].every((s) => streamed.includes(s)), streamed.join(','));

  tick({ BTC: 101_000, ETH: 2_980, SOL: 104 });
  const repeats = () => eventsOf(user.id).filter((e) => e.alertId === repeating.id).length;
  check('infinite alert waits its repeat interval', repeats() === 1);
  patchAlert(user.id, repeating.id, { lastTriggeredAt: Date.now() - 61_000 });
  tick({ ETH: 2_970 });
  check('infinite alert repeats after the interval', repeats() === 2);

  // Deliveries are async; the Telegram queue sends at most ~1 message/s per chat.
  await waitFor(async () => (await sentTo(9001)).length >= 4 && pushes.length >= 2);
  const mine = await sentTo(9001);
  check('Telegram: every firing reaches the linked chat', mine.length === 4, `${mine.length} messages`);
  check('Telegram: English by default (no language chosen)', mine.some((m) => /^🔔 <b>BTC<\/b> · Binance Futures\nPrice rose to 100,500\.00 \(alert at 100,000\.00\)$/.test(m.text ?? '')), mine[0]?.text?.replace(/\n/g, ' ⏎ '));
  const ru = (await sentTo(8001)).at(-1)?.text ?? '';
  check('Telegram: Russian for the account that chose ru', ru === '🔔 <b>BTC</b> · Binance Фьючерсы\nЦена выросла до 100,500.00 (уровень: 100,000.00)', ru.replace(/\n/g, ' ⏎ '));
  const az = (await sentTo(8002)).at(-1)?.text ?? '';
  check('Telegram: Azerbaijani complex alert (conditions translated)', az === '🔔 <b>SOL</b> · Binance Fyuçers\n1 dəq dəyişmə ≥ +2% (indi +3%)', az.replace(/\n/g, ' ⏎ '));
  check('Telegram: nothing for the account without access', (await sentTo(9002)).length === 0);
  const pushOf = (path: string) => pushes.find((p) => p.path === path);
  check('Push: sent only for alerts with push on', pushes.length === 2 && !!pushOf('/push/device-1') && !!pushOf('/push/amina'), `${pushes.length} push(es)`);
  check('Push: VAPID-signed and the encrypted payload decrypts', pushOf('/push/device-1')?.vapid === true && pushOf('/push/device-1')?.payload.title === 'BTC · Binance Futures' && pushOf('/push/device-1')?.payload.tag === `alert-${once.id}`);
  check('Push: in the account’s language too', pushOf('/push/amina')?.payload.title === 'BTC · Binance Фьючерсы' && pushOf('/push/amina')?.payload.body === 'Цена выросла до 100,500.00 (уровень: 100,000.00)', JSON.stringify(pushOf('/push/amina')?.payload));
  const subs = (JSON.parse(readFileSync(`${process.env.SX_DATA_DIR}/push-subscriptions.json`, 'utf8')) as { subs: Array<{ endpoint: string }> }).subs;
  const deliveryOf = (uid: string, alertId: string) => eventsOf(uid).find((e) => e.alertId === alertId)?.delivery;
  check('History: delivery recorded per channel (Telegram sent, push 1 device)', await waitFor(() => JSON.stringify(deliveryOf(user.id, once.id)) === '{"telegram":"sent","push":1}'), JSON.stringify(deliveryOf(user.id, once.id)));
  check('History: only chosen channels are recorded (push off → no push entry)', deliveryOf(user.id, complex.id)?.telegram === 'sent' && deliveryOf(user.id, complex.id)?.push === undefined);
  check('Push: a subscription answering 410 is dropped', !subs.some((s) => s.endpoint.endsWith('/push/gone')) && subs.some((s) => s.endpoint.endsWith('/push/device-1')));

  section('Telegram errors');
  const make = async (email: string, chat: number) => {
    const u = await createUser({ email, name: email, password: 'error-pass-1' });
    setTelegram(u.id, { id: chat, linkedAt: Date.now() });
    priceAlert(u.id, 'BTC', 1);
    return u.id;
  };
  const unlinked = await createUser({ email: 'unlinked@test.local', name: 'Unlinked', password: 'error-pass-1' });
  const unlinkedAlert = priceAlert(unlinked.id, 'BTC', 1); // Telegram chosen, no chat linked
  const flooded = await make('flood@test.local', 7001);
  const gone = await make('gone@test.local', 7002);
  const blocked = await make('blocked@test.local', 7003);
  tick({ BTC: 101_500 });
  check('429 flood control: retried after retry_after, then delivered', await waitFor(async () => (await sentTo(7001)).length === 2) && !!findById(flooded)?.telegram);
  check('400 chat not found: the dead link is removed', await waitFor(() => !findById(gone)?.telegram));
  check('403 bot blocked: the dead link is removed', await waitFor(() => !findById(blocked)?.telegram));
  check('History: dead chat recorded as Telegram failed', await waitFor(() => eventsOf(gone)[0]?.delivery?.telegram === 'failed'));
  check('History: Telegram chosen but not linked → "unlinked"', await waitFor(() => eventsOf(unlinked.id).find((e) => e.alertId === unlinkedAlert.id)?.delivery?.telegram === 'unlinked'));
  check('a failing chat doesn’t stop the others', (await sentTo(9001)).length === 4 && eventsOf(gone).length === 1);

  worker.stop();
}

main()
  .catch((e: unknown) => { results.push(`FAIL harness crashed — ${(e as Error).stack ?? String(e)}`); })
  .finally(() => {
    pushServer.close();
    console.log(results.join('\n'));
    const failed = results.filter((r) => r.startsWith('FAIL')).length;
    const total = results.filter((r) => /^(PASS|FAIL) /.test(r)).length;
    console.log(`\n${total - failed}/${total} checks passed`);
    process.exit(failed ? 1 : 0);
  });

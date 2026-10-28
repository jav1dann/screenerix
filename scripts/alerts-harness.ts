/**
 * End-to-end checks of the server-side alert pipeline and the Telegram bot, with the app's real modules:
 *   bot: /start <token> linking, the language keyboard (inline buttons → account `lang`), /language, /stop
 *   alerts: startAlertWorker → rules → store (recordFire) → deliver → Telegram queue + web-push,
 *           worded in each account's language
 *   errors: flood control (429 → retry), dead chats (400 chat not found / 403 blocked → unlink)
 *   strategy alerts: startStrategyWorker on synthetic candles (a continuation setup forming, then
 *           triggering) → matching (strategy / coin or any / timeframe / direction / strength /
 *           trigger) → Telegram + push in each language; dedupe, the per-pass cap, restarts
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
import { changesBetween, matches, notifyStrategyAlerts } from '@/lib/alerts/server/strategyAlerts';
import { ANY_COIN, MAX_STRATEGY_FIRES_PER_PASS, validateAlertInput } from '@/lib/alerts/types';
import type { AlertInput, StrategySpec } from '@/lib/alerts/types';
import { createUser, findById, setTelegram, updateUser } from '@/lib/auth/users';
import { addSubscription } from '@/lib/push/server';
import { startAlertWorker } from '@/lib/server/scan/alertWorker';
import type { AlertCoin, CoinSnapshot, MarketWorker } from '@/lib/server/scan/marketWorker';
import { startStrategyWorker } from '@/lib/server/scan/strategyWorker';
import type { Formation } from '@/lib/strategies/types';
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

  await strategyChecks(user.id, amina, lapsed.id);
}

/* ── Strategy alerts ── */

/** Quiet market, an impulse, then a range with equal lows at 103.6 (as in test:strategies), timed to end now. */
type Ohlcv = [o: number, h: number, l: number, c: number];
function rangeRows(): Ohlcv[] {
  const rows: Ohlcv[] = [];
  for (let i = 0; i < 30; i++) rows.push(i % 2 === 0 ? [99.9, 100.35, 99.75, 100.1] : [100.1, 100.25, 99.65, 99.9]);
  rows.push([99.9, 101.3, 99.8, 101.2], [101.2, 102.6, 101.1, 102.5], [102.5, 104.0, 102.4, 103.9], [103.9, 105.3, 103.8, 105.2]);
  rows.push([105.2, 105.25, 104.4, 104.5], [104.5, 104.9, 103.6, 103.8], [103.8, 104.6, 103.7, 104.4], [104.4, 104.7, 103.62, 103.9], [103.9, 104.5, 103.8, 104.3], [104.3, 104.6, 103.9, 104.2]);
  return rows;
}
const LIVE: Ohlcv = [104.0, 104.2, 103.9, 104.1];
const SWEPT: Ohlcv[] = [...rangeRows(), [104.0, 104.1, 103.0, 103.3]];
/** Swept under the lows (setup FORMING), then closed back inside (ACTIVE). */
const FORMING_ROWS: Ohlcv[] = [...SWEPT, LIVE];
const ACTIVE_ROWS: Ohlcv[] = [...SWEPT, [103.3, 103.5, 102.8, 103.2], [103.2, 104.0, 103.1, 103.9], LIVE];
const toCandles = (rows: readonly Ohlcv[]) => {
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  return rows.map(([o, h, l, c], i) => ({ t: end - (rows.length - 1 - i) * 60_000, o, h, l, c, v: 100 }));
};

async function strategyChecks(uid: string, amina: string, lapsed: string): Promise<void> {
  section('Strategy alerts');
  const spec = (p: Partial<StrategySpec> = {}): StrategySpec => ({ strategy: 'longContinuationSweep', tf: 'any', dir: 'any', minScore: 0, on: 'active', ...p });
  const raw = (symbol: string, p: Partial<StrategySpec> = {}, extra: object = {}) =>
    ({ ...BASE, kind: 'strategy', symbol, strategy: spec(p), channels: NO_PUSH, mode: 'infinite', repeatMinutes: 5, ...extra });

  const v = validateAlertInput(raw(ANY_COIN, { minScore: 250, dir: 'sideways' as never }));
  check('validation: "any coin", strength clamped to 0–100, unknown direction → any', v.ok && v.input.symbol === ANY_COIN && v.input.strategy?.minScore === 100 && v.input.strategy?.dir === 'any');
  check('validation: "any coin" only for strategy alerts', !validateAlertInput({ ...BASE, kind: 'price', symbol: ANY_COIN, price: { level: 1, direction: 'above' }, channels: NO_PUSH, mode: 'once' }).ok);
  check('validation: unknown strategy / timeframe rejected', !validateAlertInput(raw('BTC', { strategy: 'nope' as never })).ok && !validateAlertInput(raw('BTC', { tf: '4h' })).ok);

  const save = (u: string, symbol: string, p: Partial<StrategySpec> = {}, extra: object = {}) => {
    const r = validateAlertInput(raw(symbol, p, extra));
    if (!r.ok) throw new Error(r.error);
    return saveAlert(u, r.input);
  };
  // Fires: the setup triggering on any coin (Telegram + push), and one-time on first detection.
  const onActive = save(uid, ANY_COIN, { tf: '1m', minScore: 20 }, { channels: ALL });
  const onNew = save(uid, 'TEST', { strategy: 'all', on: 'new' }, { mode: 'once' });
  const ruAlert = save(amina, ANY_COIN, {}, { channels: ALL });
  // Don't fire: too weak, wrong side / coin / timeframe / strategy, no plan.
  const quiet = [
    save(uid, ANY_COIN, { minScore: 40 }),
    save(uid, ANY_COIN, { dir: 'SHORT' }),
    save(uid, 'BTC', {}),
    save(uid, ANY_COIN, { tf: '5m' }),
    save(uid, ANY_COIN, { strategy: 'breakout' }),
    save(lapsed, ANY_COIN, {}),
  ];
  check('a strategy alert stores its spec', findAlert(onActive.id)?.strategy?.tf === '1m' && findAlert(onActive.id)?.symbol === ANY_COIN);

  // The strategy worker over a one-coin venue: first the sweep (FORMING), then the reclaim (ACTIVE).
  let rows = FORMING_ROWS;
  const snap = (): CoinSnapshot[] => [{ symbol: 'TEST', price: rows[rows.length - 1][3], volume: 5e7, k1m: toCandles(rows), k5m: null, k1h: null }];
  const venue = { snapshot: snap, setHot: () => {} } as unknown as MarketWorker;
  const before = eventsOf(uid).length;
  const sentBefore = (await sentTo(9001)).length;
  const pushesBefore = pushes.length;
  const ofAlert = (u: string, id: string) => eventsOf(u, 500).filter((e) => e.alertId === id);
  const worker = startStrategyWorker('binance', venue);

  check('setup detected → the "when detected" alert fires', await waitFor(() => ofAlert(uid, onNew.id).length === 1, 6_000));
  const detected = ofAlert(uid, onNew.id)[0];
  check('…with the coin and the setup in the event', detected?.symbol === 'TEST' && detected.detail?.kind === 'strategy' && detected.detail.stage === 'FORMING' && detected.detail.strategy === 'longContinuationSweep', JSON.stringify(detected?.detail));
  check('…one-time: archived after it', findAlert(onNew.id)?.status === 'archived' && findAlert(onNew.id)?.archivedReason === 'fired');
  check('"when active" alerts wait while it’s only forming', ofAlert(uid, onActive.id).length === 0 && ofAlert(amina, ruAlert.id).length === 0);

  rows = ACTIVE_ROWS;
  check('setup triggers (ACTIVE) → "when active" alerts fire', await waitFor(() => ofAlert(uid, onActive.id).length === 1 && ofAlert(amina, ruAlert.id).length === 1, 20_000));
  const act = ofAlert(uid, onActive.id)[0];
  check('…the stored text names the strategy, levels and strength', /^Long Continuation.* · 1m LONG — active: entry 103\.9.*, SL .*, TP1 .* · strength \d+%$/.test(act?.text ?? ''), act?.text);
  check('…infinite strategy alert stays active', findAlert(onActive.id)?.status === 'active');
  check('filters hold: strength, direction, coin, timeframe, strategy and plan', quiet.every((a) => eventsOf(a.userId, 500).every((e) => e.alertId !== a.id)), quiet.map((a) => `${a.id.slice(0, 4)}:${eventsOf(a.userId, 500).filter((e) => e.alertId === a.id).length}`).join(' '));
  check('open terminals get it (event emitted for the account)', eventsOf(uid).length === before + 2);

  check('Telegram: delivered for the matching alerts', await waitFor(async () => (await sentTo(9001)).length >= sentBefore + 2, 8_000));
  const tg = (await sentTo(9001)).slice(sentBefore).map((m) => m.text ?? '');
  check('Telegram: English message with the coin, venue and levels', tg.some((t) => /^🔔 <b>TEST<\/b> · Binance Futures\nLong Continuation.* · 1m LONG — active: entry 103\.9.* · strength \d+%/.test(t)), tg.join(' | ').replace(/\n/g, ' ⏎ '));
  check('Telegram: in Russian for the ru account', await waitFor(async () => /^🔔 <b>TEST<\/b> · Binance Фьючерсы\n.* · 1m LONG — активна: вход 103\.9.* · сила \d+%/.test((await sentTo(8001)).at(-1)?.text ?? '')), ((await sentTo(8001)).at(-1)?.text ?? '').replace(/\n/g, ' ⏎ '));
  check('Push: sent with the coin as the title', await waitFor(() => pushes.slice(pushesBefore).some((p) => p.path === '/push/device-1' && p.payload.title === 'TEST · Binance Futures' && /active: entry/.test(String(p.payload.body)))), JSON.stringify(pushes.slice(pushesBefore).map((p) => p.payload)));
  check('History: delivery recorded', await waitFor(() => ofAlert(uid, onActive.id)[0]?.delivery?.telegram === 'sent' && ofAlert(uid, onActive.id)[0]?.delivery?.push === 1), JSON.stringify(ofAlert(uid, onActive.id)[0]?.delivery));

  await sleep(16_000); // one more pass on the same setup
  check('the same setup isn’t reported twice', ofAlert(uid, onActive.id).length === 1 && ofAlert(amina, ruAlert.id).length === 1);
  worker.stop();

  // Pure parts: changes between passes (a restart seeds from the cache), the per-pass cap.
  const f = (id: string, stage: Formation['stage'], extra: Partial<Formation> = {}): Formation => ({
    id, strategy: 'longContinuationSweep', tf: '1m', dir: 'LONG', anchorT: 0, entry: 10, sl: 9, tp1: 11, tp2: 12, score: 50, orderFlow: false, dailyAligned: false, note: '',
    venue: 'binance', symbol: 'TEST', stage, price: 10, potential: 20, quality: 'MID', volume24h: 1e7, detectedAt: 0, stageAt: 0, seenAt: 0, ...extra,
  });
  const ch = changesBetween(new Map([['a', 'FORMING'], ['b', 'ACTIVE']]), [f('a', 'ACTIVE'), f('b', 'ACTIVE'), f('c', 'FORMING')]);
  check('changes: FORMING→ACTIVE is "activated", unseen ids are "new", unchanged ones nothing', ch.map((c) => `${c.formation.id}:${+c.isNew}${+c.activated}`).join() === 'a:01,c:10', ch.map((c) => `${c.formation.id}:${+c.isNew}${+c.activated}`).join());
  check('changes: nothing after a restart seeded from the same formations', changesBetween(new Map([['a', 'ACTIVE']]), [f('a', 'ACTIVE')]).length === 0);
  const alertLike = { kind: 'strategy' as const, symbol: ANY_COIN, strategy: spec({ minScore: 60 }) };
  check('matching: strength index wins over score; invalidated / done setups never match', matches(alertLike, { formation: f('x', 'ACTIVE', { score: 90, strength: { value: 50, factors: [] } }), isNew: true, activated: true }) === false
    && matches(alertLike, { formation: f('x', 'ACTIVE', { score: 30, strength: { value: 70, factors: [] } }), isNew: true, activated: true }) === true
    && matches({ ...alertLike, strategy: spec({ on: 'new' }) }, { formation: f('x', 'INVALIDATED'), isNew: true, activated: false }) === false
    && matches(alertLike, { formation: f('x', 'ACTIVE', { score: 90, doneAt: 1 }), isNew: true, activated: true }) === false);
  const burst = Array.from({ length: 8 }, (_, i) => ({ formation: f(`burst${i}`, 'ACTIVE', { symbol: `C${i}` }), isNew: true, activated: true }));
  const capped = save(uid, ANY_COIN, {});
  const n = notifyStrategyAlerts('binance', burst);
  check(`a market-wide burst is capped at ${MAX_STRATEGY_FIRES_PER_PASS} per alert and pass`, ofAlert(uid, capped.id).length === MAX_STRATEGY_FIRES_PER_PASS, `${ofAlert(uid, capped.id).length} events (${n} sent in total)`);
  check('other venues’ alerts are left alone', notifyStrategyAlerts('bybit', burst) === 0);
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

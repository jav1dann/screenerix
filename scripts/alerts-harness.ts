/**
 * End-to-end checks of the server-side alert pipeline, with the app's real modules:
 *   startAlertWorker → rules → store (recordFire) → deliver → Telegram send queue + web-push.
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
import { createUser, setTelegram, updateUser } from '@/lib/auth/users';
import { addSubscription } from '@/lib/push/server';
import { startAlertWorker } from '@/lib/server/scan/alertWorker';
import type { AlertCoin, MarketWorker } from '@/lib/server/scan/marketWorker';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Local push service: records each message (decrypted) and answers 410 for `/push/gone`. */
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

/** Fake venue feed: the slice of MarketWorker the alert worker uses. */
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

async function main(): Promise<void> {
  await new Promise<void>((r) => pushServer.listen(0, '127.0.0.1', r));
  const pushBase = `https://localhost:${(pushServer.address() as AddressInfo).port}`;
  const subKeys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };

  const user = await createUser({ email: 'trader@test.local', name: 'Trader', password: 'trader-pass-1' });
  setTelegram(user.id, { id: 9001, username: 'trader', linkedAt: Date.now() });
  addSubscription(user.id, { endpoint: `${pushBase}/push/device-1`, keys: subKeys });
  addSubscription(user.id, { endpoint: `${pushBase}/push/gone`, keys: subKeys });
  const lapsed = await createUser({ email: 'lapsed@test.local', name: 'Lapsed', password: 'lapsed-pass-1' });
  updateUser(lapsed.id, { trialEndsAt: Date.now() - 1_000 });
  setTelegram(lapsed.id, { id: 9002, linkedAt: Date.now() });

  const streamed: string[] = [];
  onUserAlerts(user.id, (c) => { if (c.type === 'event') streamed.push(c.event.symbol); });

  const once = saveAlert(user.id, { ...BASE, kind: 'price', symbol: 'BTC', price: { level: 100_000, direction: 'above' }, channels: ALL, mode: 'once', repeatMinutes: 5 } as AlertInput);
  const repeating = saveAlert(user.id, { ...BASE, kind: 'price', symbol: 'ETH', price: { level: 3_000, direction: 'below' }, channels: NO_PUSH, mode: 'infinite', repeatMinutes: 1 } as AlertInput);
  const complex = saveAlert(user.id, { ...BASE, kind: 'complex', symbol: 'SOL', conditions: [{ metric: 'change', window: '1m', op: '>', value: 2 }], channels: NO_PUSH, mode: 'once', repeatMinutes: 5 } as AlertInput);
  const lapsedAlert = saveAlert(lapsed.id, { ...BASE, kind: 'price', symbol: 'BTC', price: { level: 1, direction: 'above' }, channels: ALL, mode: 'once', repeatMinutes: 5 } as AlertInput);

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
  await sleep(4_500);
  const sent = (await (await fetch(`${TELEGRAM}/__sent`)).json()) as Array<{ chat_id: number; text: string; parse_mode: string }>;
  const mine = sent.filter((m) => m.chat_id === 9001);
  check('Telegram: every firing reaches the linked chat', mine.length === 4, `${mine.length} messages`);
  check('Telegram: HTML message with coin, venue and trigger', mine.some((m) => m.parse_mode === 'HTML' && /^🔔 <b>BTC<\/b> · Binance Futures\nPrice rose to/.test(m.text)));
  check('Telegram: nothing for the account without access', !sent.some((m) => m.chat_id === 9002));
  check('Push: sent only for the alert with push on', pushes.length === 1 && pushes[0].path === '/push/device-1', `${pushes.length} push(es)`);
  check('Push: VAPID-signed and the encrypted payload decrypts', pushes[0]?.vapid === true && pushes[0]?.payload.title === 'BTC · Binance Futures' && pushes[0]?.payload.tag === `alert-${once.id}`);
  const subs = (JSON.parse(readFileSync(`${process.env.SX_DATA_DIR}/push-subscriptions.json`, 'utf8')) as { subs: Array<{ endpoint: string }> }).subs;
  check('Push: a subscription answering 410 is dropped', subs.length === 1 && subs[0].endpoint.endsWith('/push/device-1'));

  worker.stop();
}

main()
  .catch((e: unknown) => { results.push(`FAIL harness crashed — ${(e as Error).stack ?? String(e)}`); })
  .finally(() => {
    pushServer.close();
    console.log(results.join('\n'));
    const failed = results.filter((r) => r.startsWith('FAIL')).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });

/**
 * Notification languages (Telegram bot + web push): the bot's replies and alert messages in
 * Azərbaycanca, English and Русский. The user picks one in the bot (inline keyboard, /language);
 * it's stored on the account (`UserRecord.lang`). Pure — no I/O.
 */
import { METRIC_BY_ID } from '@/lib/alerts/types';
import type { AlertDetail, AlertEvent, Condition, Metric, MetricWindow } from '@/lib/alerts/types';
import { fmtPrice } from '@/lib/format';
import { ADAPTERS } from '@/lib/market/exchanges';

export type Lang = 'az' | 'en' | 'ru';
export const LANGS: readonly Lang[] = ['az', 'en', 'ru'];
export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

/** Button labels of the language keyboard (each in its own language). */
export const LANG_LABEL: Record<Lang, string> = { az: '🇦🇿 Azərbaycanca', en: '🇬🇧 English', ru: '🇷🇺 Русский' };

/** A first guess from Telegram's `language_code` (until the user picks one). */
export const guessLang = (code: string | undefined): Lang => {
  const base = code?.toLowerCase().split('-')[0];
  return base === 'az' || base === 'ru' ? base : 'en';
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Strings {
  choose: string;
  saved: string;
  hello: string;
  linked: (email: string) => string;
  expired: string;
  status: (email: string) => string;
  stopped: string;
  notLinked: string;
  open: string;
  futures: string;
  spot: string;
  rose: (price: string, level: string) => string;
  fell: (price: string, level: string) => string;
  and: string;
  now: string;
  metric: Record<Metric, string>;
  window: Record<MetricWindow, string>;
  commands: { start: string; language: string; stop: string };
}

const BUTTON = '<b>Account settings → Linked accounts</b>';

export const STRINGS: Record<Lang, Strings> = {
  en: {
    choose: 'Choose the language for your alerts:',
    saved: '✅ Language: English. Alerts will arrive in English — change it any time with /language.',
    hello: `Hi! To get Screenerix alerts here, open ${BUTTON} in the terminal and press <b>Connect Telegram</b>.`,
    linked: (email) => `✅ Connected to Screenerix as <b>${esc(email)}</b>. Alerts with Telegram turned on will arrive here. Send /stop to disconnect.`,
    expired: 'This link has expired. Press <b>Connect Telegram</b> in Screenerix again.',
    status: (email) => `Connected as <b>${esc(email)}</b>. Alerts arrive here automatically. /language changes the language, /stop disconnects.`,
    stopped: 'Disconnected. You won’t get Screenerix alerts here any more.',
    notLinked: 'This Telegram account isn’t connected to Screenerix.',
    open: 'Open Screenerix',
    futures: 'Futures',
    spot: 'Spot',
    rose: (p, l) => `Price rose to ${p} (alert at ${l})`,
    fell: (p, l) => `Price fell to ${p} (alert at ${l})`,
    and: 'AND',
    now: 'now',
    metric: { change: 'change', volSpike: 'volume', price: 'price', funding: 'funding', oiChange: 'OI' },
    window: { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h' },
    commands: { start: 'Connect or show status', language: 'Change the language', stop: 'Disconnect from Screenerix' },
  },
  az: {
    choose: 'Bildirişlərin dilini seçin:',
    saved: '✅ Dil: Azərbaycanca. Bildirişlər azərbaycan dilində gələcək — dili istənilən vaxt /language ilə dəyişə bilərsiniz.',
    hello: `Salam! Screenerix bildirişlərini burada almaq üçün terminalda ${BUTTON} bölməsini açın və <b>Connect Telegram</b> düyməsini basın.`,
    linked: (email) => `✅ Screenerix hesabına qoşuldu: <b>${esc(email)}</b>. Telegram seçilmiş bildirişlər bura gələcək. Ayırmaq üçün /stop göndərin.`,
    expired: 'Bu keçidin vaxtı bitib. Screenerix-də yenidən <b>Connect Telegram</b> düyməsini basın.',
    status: (email) => `<b>${esc(email)}</b> hesabına qoşulub. Bildirişlər bura avtomatik gəlir. /language — dili dəyişmək, /stop — ayırmaq.`,
    stopped: 'Ayrıldı. Screenerix bildirişləri artıq bura gəlməyəcək.',
    notLinked: 'Bu Telegram hesabı Screenerix-ə qoşulmayıb.',
    open: 'Screenerix-i aç',
    futures: 'Fyuçers',
    spot: 'Spot',
    rose: (p, l) => `Qiymət ${p} səviyyəsinə qalxdı (siqnal: ${l})`,
    fell: (p, l) => `Qiymət ${p} səviyyəsinə düşdü (siqnal: ${l})`,
    and: 'VƏ',
    now: 'indi',
    metric: { change: 'dəyişmə', volSpike: 'həcm', price: 'qiymət', funding: 'fandinq', oiChange: 'OI' },
    window: { '1m': '1 dəq', '5m': '5 dəq', '15m': '15 dəq', '1h': '1 saat' },
    commands: { start: 'Qoşulmaq və ya statusu göstərmək', language: 'Dili dəyişmək', stop: 'Screenerix-dən ayırmaq' },
  },
  ru: {
    choose: 'Выберите язык уведомлений:',
    saved: '✅ Язык: русский. Уведомления будут приходить на русском — сменить язык можно в любой момент командой /language.',
    hello: `Привет! Чтобы получать уведомления Screenerix здесь, откройте в терминале ${BUTTON} и нажмите <b>Connect Telegram</b>.`,
    linked: (email) => `✅ Подключено к Screenerix: <b>${esc(email)}</b>. Уведомления с включённым Telegram будут приходить сюда. Чтобы отключить, отправьте /stop.`,
    expired: 'Срок действия ссылки истёк. Нажмите <b>Connect Telegram</b> в Screenerix ещё раз.',
    status: (email) => `Подключено: <b>${esc(email)}</b>. Уведомления приходят сюда автоматически. /language — сменить язык, /stop — отключить.`,
    stopped: 'Отключено. Уведомления Screenerix сюда больше не будут приходить.',
    notLinked: 'Этот аккаунт Telegram не подключён к Screenerix.',
    open: 'Открыть Screenerix',
    futures: 'Фьючерсы',
    spot: 'Спот',
    rose: (p, l) => `Цена выросла до ${p} (уровень: ${l})`,
    fell: (p, l) => `Цена упала до ${p} (уровень: ${l})`,
    and: 'И',
    now: 'сейчас',
    metric: { change: 'изменение', volSpike: 'объём', price: 'цена', funding: 'фандинг', oiChange: 'OI' },
    window: { '1m': '1 мин', '5m': '5 мин', '15m': '15 мин', '1h': '1 ч' },
    commands: { start: 'Подключить или показать статус', language: 'Сменить язык', stop: 'Отключиться от Screenerix' },
  },
};

const num = (v: number) => `${+v.toFixed(Math.abs(v) < 1 ? 4 : 2)}`;

/** A metric value with its unit: "+3%", "4.1×", "65,000.00". */
function fmtMetric(metric: Metric, v: number, signed: boolean): string {
  const unit = METRIC_BY_ID.get(metric)!.unit;
  if (unit === '%') return `${signed && v > 0 ? '+' : ''}${num(v)}%`;
  return unit === '×' ? `${num(v)}×` : fmtPrice(v);
}

/** "5 мин изменение ≥ +3% (сейчас +3.4%)". */
function describeCheck(t: Strings, c: Condition, value: number | null): string {
  const m = METRIC_BY_ID.get(c.metric)!;
  const op = c.op === '>' ? '≥' : c.op === '<' ? '≤' : '|x| ≥';
  const head = `${m.windowed ? `${t.window[c.window]} ` : ''}${t.metric[c.metric]} ${op} ${fmtMetric(c.metric, c.value, c.op !== 'abs>')}`;
  return value === null ? head : `${head} (${t.now} ${fmtMetric(c.metric, value, true)})`;
}

/** What triggered, in `lang` ("Price rose to …" / "5m change ≥ +2% (now +3%) AND …"); the stored English text without a detail. */
export function triggerText(e: Pick<AlertEvent, 'price' | 'text'> & { detail?: AlertDetail }, lang: Lang): string {
  const t = STRINGS[lang];
  const d = e.detail;
  if (!d) return e.text;
  if (d.kind === 'price') return (d.direction === 'above' ? t.rose : t.fell)(fmtPrice(e.price), fmtPrice(d.level));
  return d.checks.map((x) => describeCheck(t, x.condition, x.value)).join(` ${t.and} `);
}

/** "Binance Futures" / "Binance Фьючерсы". */
export function venueText(exchange: AlertEvent['exchange'], lang: Lang): string {
  const a = ADAPTERS[exchange];
  return `${a.name} ${a.market === 'perp' ? STRINGS[lang].futures : STRINGS[lang].spot}`;
}

/** The Telegram alert message (HTML parse mode). */
export function telegramAlert(e: AlertEvent, lang: Lang, appUrl: string): string {
  const link = appUrl ? `\n<a href="${esc(appUrl)}/terminal">${STRINGS[lang].open}</a>` : '';
  return `🔔 <b>${esc(e.symbol)}</b> · ${esc(venueText(e.exchange, lang))}\n${esc(triggerText(e, lang))}${link}`;
}

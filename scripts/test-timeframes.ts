/**
 * `npm run test:timeframes` — candle construction across timeframes, with the server's real loaders
 * (`getSubMinuteCandles`, `getKlines`) against venue-format upstream answers built from one synthetic
 * market: a deterministic random walk, a trade every 100 ms (a busy coin) for three hours.
 *
 *   30s / 1s from trades (Binance aggTrades, id paging), from native 1s (OKX, aggregated) and native
 *   30s (Gate): every returned candle must equal the true candle exactly (OHLCV), pages scrolled back
 *   through the cursor must join without gaps or overlaps, and history must reach far back.
 *   Aggregated klines (Coinbase 4h from 1h): no partial first candle.
 *   Live folding (`applyTrade`) and bucket alignment for every chart timeframe.
 *
 * `fetch` is stubbed (no network). Exits 1 on any failed check.
 */
import { TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ChartTimeframe, RawCandle, SubMinute } from '@/lib/market/exchanges';
import { aggregate, applyTrade, trimPartialHead } from '@/lib/market/exchanges/shared';
import { getKlines, getSubMinuteCandles } from '@/lib/market/server/marketData';
import { CHART_TIMEFRAMES } from '@/components/chart/expanded/ExpandedHeader';

const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);

/* ── The synthetic market ── */
interface Trade { id: number; t: number; price: number; size: number; buy: boolean }
const NOW = Math.floor(Date.now() / 1000) * 1000;
const START = NOW - 3 * 3_600_000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const TRADES: Trade[] = [];
{
  let price = 100;
  let id = 5_000_000;
  for (let t = START; t < NOW - 1_000; t += 100) {
    price = Math.max(1, +(price * (1 + (rnd() - 0.5) * 0.002)).toFixed(4));
    TRADES.push({ id: id++, t, price, size: +(0.1 + rnd()).toFixed(3), buy: rnd() > 0.5 });
  }
}
/** The truth: candles of `span` from every trade (oldest first). */
function truth(span: number): Map<number, RawCandle> {
  const m = new Map<number, RawCandle>();
  for (const tr of TRADES) {
    const b = Math.floor(tr.t / span) * span;
    const c = m.get(b);
    if (!c) m.set(b, { t: b, o: tr.price, h: tr.price, l: tr.price, c: tr.price, v: tr.size });
    else { c.h = Math.max(c.h, tr.price); c.l = Math.min(c.l, tr.price); c.c = tr.price; c.v += tr.size; }
  }
  return m;
}
const T30 = truth(30_000);
const T1 = truth(1_000);
const sameCandle = (a: RawCandle, b: RawCandle | undefined) =>
  !!b && a.t === b.t && Math.abs(a.o - b.o) < 1e-9 && Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.l - b.l) < 1e-9 && Math.abs(a.c - b.c) < 1e-9 && Math.abs(a.v - b.v) < 1e-6;
/** Buckets that closed before the newest trade (the newest one is still filling). */
const closed = (cs: RawCandle[], span: number) => cs.filter((c) => c.t + span <= TRADES[TRADES.length - 1].t);

/* ── Venue-format upstream ── */
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let requests = 0;
const binanceAgg = (from: number) => TRADES.filter((x) => x.id >= from).slice(0, 1000).map((x) => ({ a: x.id, p: String(x.price), q: String(x.size), T: x.t, m: !x.buy }));
const HOURLY: RawCandle[] = [];
{
  const h0 = Math.floor(NOW / 3_600_000) * 3_600_000 - 400 * 3_600_000;
  let p = 50;
  for (let i = 0; i < 400; i++) {
    const o = p; p = +(p * (1 + (rnd() - 0.5) * 0.02)).toFixed(4);
    HOURLY.push({ t: h0 + i * 3_600_000, o, h: Math.max(o, p) + 0.5, l: Math.min(o, p) - 0.5, c: p, v: 10 + i });
  }
}
globalThis.fetch = (async (input: string | URL | Request) => {
  requests++;
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const q = u.searchParams;
  switch (`${u.hostname}${u.pathname}`) {
    case 'fapi.binance.com/fapi/v1/exchangeInfo':
      return json({ symbols: [{ status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT', baseAsset: 'TEST', symbol: 'TESTUSDT' }] });
    case 'fapi.binance.com/fapi/v1/aggTrades':
      return json(q.has('fromId') ? binanceAgg(Number(q.get('fromId'))) : binanceAgg(TRADES[TRADES.length - 1000].id));
    case 'www.okx.com/api/v5/public/instruments':
      return json({ data: [{ state: 'live', instId: 'TEST-USDT-SWAP', ctVal: '1' }] });
    case 'www.okx.com/api/v5/market/candles': {
      const after = q.get('after');
      const rows = [...T1.values()].filter((c) => c.t < NOW - 1_000 && (!after || c.t < Number(after))).slice(-Number(q.get('limit')));
      return json({ data: rows.reverse().map((c) => [String(c.t), String(c.o), String(c.h), String(c.l), String(c.c), String(c.v)]) });
    }
    case 'api.gateio.ws/api/v4/futures/usdt/contracts':
      return json([{ name: 'TEST_USDT', quanto_multiplier: '1' }]);
    case 'api.gateio.ws/api/v4/futures/usdt/candlesticks': {
      const all = [...T30.values()];
      const rows = q.has('from') ? all.filter((c) => c.t / 1000 >= Number(q.get('from')) && c.t / 1000 <= Number(q.get('to'))) : all.slice(-Number(q.get('limit')));
      return json(rows.map((c) => ({ t: c.t / 1000, o: String(c.o), h: String(c.h), l: String(c.l), c: String(c.c), v: c.v })));
    }
    case 'api.exchange.coinbase.com/products':
      return json([{ id: 'TEST-USD', base_currency: 'TEST', quote_currency: 'USD', status: 'online', trading_disabled: false }]);
    case 'api.exchange.coinbase.com/products/TEST-USD/candles': {
      // The window starts one hour into a 4h bucket: aggregating it must not yield a partial first 4h candle.
      const rows = HOURLY.slice(-300);
      while (rows[0].t % (4 * 3_600_000) !== 3_600_000) rows.shift();
      return json(rows.reverse().map((c) => [c.t / 1000, c.l, c.h, c.o, c.c, c.v]));
    }
    default:
      return new Response('not mocked: ' + u.href, { status: 404 });
  }
}) as typeof fetch;

/** First page plus `pages` scroll-backs through the cursor; checks every candle against the truth. */
async function subMinute(venue: 'binance' | 'okx' | 'gate', tf: SubMinute, label: string, scrolls: number): Promise<void> {
  const span = TIMEFRAME_MS[tf];
  const T = tf === '30s' ? T30 : T1;
  const first = await getSubMinuteCandles(venue, 'TEST', tf);
  check(`${label}: first load has history`, first.candles.length >= 15, `${first.candles.length} candles`);
  const wrong = closed(first.candles, span).filter((c) => !sameCandle(c, T.get(c.t)));
  check(`${label}: every closed candle equals the true candle (OHLCV)`, wrong.length === 0, wrong.length ? `first wrong at ${new Date(wrong[0].t).toISOString()}` : `${first.candles.length} checked`);
  check(`${label}: buckets aligned to ${tf}`, first.candles.every((c) => c.t % span === 0));
  check(`${label}: returns a cursor to scroll back`, typeof first.cursor === 'string');
  let series = first.candles;
  let cursor = first.cursor;
  let joined = true, exact = true, pagesLoaded = 0;
  for (let i = 0; i < scrolls && cursor; i++) {
    const page = await getSubMinuteCandles(venue, 'TEST', tf, cursor);
    cursor = page.cursor;
    if (!page.candles.length) continue;
    pagesLoaded++;
    // Contiguous: the older page ends exactly one bucket before the series starts (every bucket has trades here).
    if (page.candles[page.candles.length - 1].t + span !== series[0].t) joined = false;
    if (page.candles.some((c) => !sameCandle(c, T.get(c.t)))) exact = false;
    series = [...page.candles, ...series];
  }
  check(`${label}: scrolled-back pages join with no gap or overlap`, joined && pagesLoaded > 0, `${pagesLoaded} older pages`);
  check(`${label}: scrolled-back candles are exact too`, exact);
  const minutes = (series[series.length - 1].t - series[0].t) / 60_000;
  // 1s from trades on a busy coin: each scroll-back is a few thousand trades (minutes, not hours).
  const need = tf === '1s' ? 15 : 60;
  check(`${label}: history after scrolling covers ≥ ${need} min`, minutes >= need, `${minutes.toFixed(0)} min, ${series.length} candles`);
}

async function main(): Promise<void> {
  section('Bucket alignment for every chart timeframe');
  check('every chart timeframe has a span', CHART_TIMEFRAMES.every((tf) => TIMEFRAME_MS[tf] > 0), CHART_TIMEFRAMES.join(' '));
  const t = Date.UTC(2026, 0, 5, 13, 47, 31, 400);
  for (const tf of CHART_TIMEFRAMES as readonly ChartTimeframe[]) {
    const s: RawCandle[] = [];
    const c = applyTrade(s, TIMEFRAME_MS[tf], 10, 1, t, 100);
    check(`${tf}: a trade opens the bucket containing it`, !!c && c.t <= t && t < c.t + TIMEFRAME_MS[tf] && c.t % TIMEFRAME_MS[tf] === 0, c ? new Date(c.t).toISOString() : '');
  }

  section('Live folding (30s)');
  const s: RawCandle[] = [];
  const b0 = Math.floor(NOW / 30_000) * 30_000;
  applyTrade(s, 30_000, 10, 1, b0 + 1_000, 100, 'buy');
  applyTrade(s, 30_000, 12, 2, b0 + 9_000, 100, 'sell');
  applyTrade(s, 30_000, 9, 1, b0 + 20_000, 100, 'buy');
  check('trades in one bucket: O/H/L/C/V/taker-buy', s.length === 1 && s[0].o === 10 && s[0].h === 12 && s[0].l === 9 && s[0].c === 9 && s[0].v === 4 && s[0].tb === 2, JSON.stringify(s[0]));
  applyTrade(s, 30_000, 11, 1, b0 + 31_000, 100);
  check('next bucket opens at its first trade (like venue candles)', s.length === 2 && s[1].t === b0 + 30_000 && s[1].o === 11 && s[1].c === 11);
  check('…and its high / low are only prices traded in it', s[1].h === 11 && s[1].l === 11, JSON.stringify(s[1]));
  check('a late trade from an older bucket is ignored', applyTrade(s, 30_000, 50, 1, b0 + 5_000, 100) === null && s[0].h === 12);

  section('30s from trades — Binance (aggTrades, id paging)');
  await subMinute('binance', '30s', 'Binance 30s', 12);
  section('1s from trades — Binance');
  await subMinute('binance', '1s', 'Binance 1s', 3);
  section('30s aggregated from native 1s — OKX');
  await subMinute('okx', '30s', 'OKX 30s', 6);
  section('Native 30s — Gate');
  await subMinute('gate', '30s', 'Gate 30s', 3);

  section('Aggregated klines (no partial first candle)');
  // 300 = the chart's seed size: more than the window holds, so nothing would hide a partial first candle.
  const h4 = await getKlines('coinbase', 'TEST', '4h', 300);
  const true4h = new Map(aggregate(HOURLY.map((c) => ({ ...c })), 4 * 3_600_000).map((c) => [c.t, c]));
  const bad4h = h4.filter((c) => !sameCandle(c, true4h.get(c.t)));
  check('Coinbase 4h (from 1h): every candle complete and exact', h4.length > 0 && bad4h.length === 0, `${h4.length} candles${bad4h.length ? `, first wrong ${new Date(bad4h[0].t).toISOString()}` : ''}`);
  check('trimPartialHead keeps an aligned start', trimPartialHead([{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 60_000, o: 1, h: 1, l: 1, c: 1, v: 1 }], 0, 60_000).length === 2);
  check('trimPartialHead drops a start inside the bucket', trimPartialHead([{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 60_000, o: 1, h: 1, l: 1, c: 1, v: 1 }], 15_000, 60_000).length === 1);
  results.push(`\n(${requests} stubbed upstream requests)`);
}

main()
  .catch((e: unknown) => { results.push(`FAIL harness crashed — ${(e as Error).stack ?? String(e)}`); })
  .finally(() => {
    console.log(results.join('\n'));
    const failed = results.filter((r) => r.startsWith('FAIL')).length;
    const total = results.filter((r) => /^(PASS|FAIL) /.test(r)).length;
    console.log(`\n${total - failed}/${total} checks passed`);
    process.exit(failed ? 1 : 0);
  });

/**
 * `npm run test:venues` — market data when some exchanges refuse this server's region (the VPS
 * case: Binance futures HTTP 451, Bybit HTTP 403) while others serve it:
 *   server   — the per-host circuit breaker (no repeated calls to a refused host, the next check
 *              after RECHECK_MS, recovery), the API's VENUE_RESTRICTED answer, /api/market/venues,
 *              and that an ordinary outage (5xx / network) is NOT treated as a restriction;
 *   browser  — the live feed with a refused primary: other venues stream independently, the
 *              refused one shows "restricted" (not a retry loop), stale quotes after a drop, and
 *              recovery when the exchange serves again;
 *   arbitrage — only genuine, current quotes: rows from every available venue (not the primary's
 *              list), at least two quotes per spread, stale / disconnected / outlier quotes left
 *              out, nothing substituted;
 *   choice   — new visitors land on a working exchange, picked venues are kept, futures and spot
 *              never mixed.
 * No network: exchanges, the API and WebSockets are stubbed. Exits 1 on any failed check.
 */
const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const realFetch = globalThis.fetch;
const realNow = Date.now;
const quiet = { log: console.log, warn: console.warn, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);

/* ── Fake WebSocket (browser feed) ── */
class FakeSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  send(frame: string) { this.sent.push(frame); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: 'network' }); }
}

(async () => {
  /* ═════════════ Server: circuit breaker ═════════════ */
  section('Server — circuit breaker (per host)');
  const md = await import('@/lib/market/server/marketData');
  const vh = await import('@/lib/market/server/venueHealth');
  const { ADAPTERS } = await import('@/lib/market/exchanges');
  const calls = new Map<string, number>();
  const answers = new Map<string, () => Response | Promise<Response>>([
    ['fapi.binance.com', () => new Response('{"code":0,"msg":"Service unavailable from a restricted location"}', { status: 451 })],
    ['api.bybit.com', () => new Response('<html>403 ERROR — CloudFront</html>', { status: 403 })],
    ['www.okx.com', () => Response.json({ ok: true })],
    ['api.bitget.com', () => new Response('oops', { status: 500 })],
    ['api.gateio.ws', () => { throw new TypeError('fetch failed'); }],
  ]);
  globalThis.fetch = (async (url: string) => {
    const host = new URL(url).host;
    calls.set(host, (calls.get(host) ?? 0) + 1);
    const a = answers.get(host);
    if (!a) throw new Error(`unexpected host ${host}`);
    return a();
  }) as typeof fetch;
  mute();
  const binUrl = ADAPTERS.binance.rest.instrumentsUrl, bybUrl = ADAPTERS.bybit.rest.instrumentsUrl;
  const errOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status?: number; code?: string; retryAt?: number; message?: string });
  const e1 = await errOf(md.upstreamJson(binUrl));
  check('Binance futures 451 → "restricted" (503), not a generic 502', e1?.code === 'restricted' && e1?.status === 503, JSON.stringify({ code: e1?.code, status: e1?.status }));
  const e2 = await errOf(md.upstreamJson(`${binUrl}?again=1`));
  check('…the next call fails at once without contacting the exchange', e2?.code === 'restricted' && calls.get('fapi.binance.com') === 1, `calls ${calls.get('fapi.binance.com')}`);
  for (let i = 0; i < 25; i++) await errOf(md.upstreamJson(binUrl));
  check('…25 more calls (workers, users): still exactly 1 request', calls.get('fapi.binance.com') === 1);
  const e3 = await errOf(md.upstreamJson(bybUrl));
  check('Bybit 403 (CloudFront) → restricted too', e3?.code === 'restricted' && vh.venueHealth('bybit').state === 'restricted' && vh.venueHealth('bybit').status === 403);
  check('OKX keeps working independently', JSON.stringify(await md.upstreamJson(ADAPTERS.okx.rest.instrumentsUrl)) === '{"ok":true}' && vh.venueHealth('okx').state === 'ok');
  const e4 = await errOf(md.upstreamJson(ADAPTERS.bitget.rest.instrumentsUrl));
  await errOf(md.upstreamJson(ADAPTERS.bitget.rest.instrumentsUrl));
  check('a 5xx outage is NOT a restriction (502, retried normally)', e4?.status === 502 && e4?.code === undefined && calls.get('api.bitget.com') === 2 && vh.venueHealth('bitget').state === 'ok');
  const e5 = await errOf(md.upstreamJson(ADAPTERS.gate.rest.instrumentsUrl));
  check('a network failure is NOT a restriction either', e5?.code === undefined && vh.venueHealth('gate').state === 'ok');
  check('the refused host is per host: Binance spot (another host) is not blocked by it', vh.hostHealth('https://api.binance.com/api/v3/ping').state === 'ok');

  section('Server — API answers');
  const r1 = md.venueRestrictedResponse('binance')!;
  const b1 = await r1.json() as { code?: string; venue?: string; error?: string; retryAt?: number };
  check('market routes answer 503 VENUE_RESTRICTED with Retry-After', r1.status === 503 && b1.code === 'VENUE_RESTRICTED' && b1.venue === 'binance' && Number(r1.headers.get('retry-after')) > 60, `${r1.status} ${r1.headers.get('retry-after')}`);
  check('…with a plain explanation', /Binance doesn’t serve market data to this server’s region \(HTTP 451\)/.test(b1.error ?? ''), b1.error);
  check('…and no answer for an exchange that works', md.venueRestrictedResponse('okx') === null);
  const lost = md.upstreamErrorResponse(new Error('An error occurred in the Server Components render'), 'binance');
  check('a refusal that lost its type inside a cache function still answers as restricted', lost.status === 503 && (await lost.json() as { code?: string }).code === 'VENUE_RESTRICTED');
  const vj = vh.venueHealthReport() as { venues: Record<string, { state: string; status?: number }> };
  check('/api/market/venues: Binance + Bybit restricted, the rest ok', vj.venues.binance.state === 'restricted' && vj.venues.binance.status === 451 && vj.venues.bybit.status === 403 && ['okx', 'bitget', 'gate', 'coinbase'].every((v) => vj.venues[v].state === 'ok'));
  const { GET: tickersGET } = await import('@/app/api/market/[exchange]/tickers/route');
  const before = calls.get('fapi.binance.com');
  const tr = await tickersGET(new Request('http://x/api/market/binance/tickers') as never, { params: Promise.resolve({ exchange: 'binance' }) } as never);
  check('GET /api/market/binance/tickers → 503 without touching the exchange', tr.status === 503 && calls.get('fapi.binance.com') === before);

  section('Server — recovery');
  const t0 = realNow();
  Date.now = () => t0 + vh.RECHECK_MS + 1_000;
  answers.set('fapi.binance.com', () => new Response('{"code":0}', { status: 451 }));
  await errOf(md.upstreamJson(binUrl));
  check('after RECHECK_MS one probe goes out', calls.get('fapi.binance.com') === 2);
  check('…refused again: re-opened, next check pushed out', vh.venueHealth('binance').state === 'restricted' && (vh.venueHealth('binance').retryAt ?? 0) > Date.now() + vh.RECHECK_MS - 5_000);
  Date.now = () => t0 + 2 * vh.RECHECK_MS + 2_000;
  answers.set('fapi.binance.com', () => Response.json({ symbols: [] }));
  const ok = await md.upstreamJson(binUrl).then(() => true, () => false);
  check('the exchange serves again: the probe succeeds and the venue is back', ok && vh.venueHealth('binance').state === 'ok' && md.venueRestrictedResponse('binance') === null);
  await md.upstreamJson(binUrl);
  check('…and requests flow normally again', calls.get('fapi.binance.com') === 4);
  Date.now = realNow;
  unmute();

  /* ═════════════ Browser feed ═════════════ */
  section('Browser feed — one refused venue, the others independent');
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  const okxInst = { BTC: { inst: 'BTC-USDT-SWAP', contractSize: 0.01, priceScale: 1 }, ETH: { inst: 'ETH-USDT-SWAP', contractSize: 0.1, priceScale: 1 } };
  const bitgetInst = { BTC: { inst: 'BTCUSDT', contractSize: 1, priceScale: 1 }, SOL: { inst: 'SOLUSDT', contractSize: 1, priceScale: 1 } };
  const api = new Map<string, number>();
  let binanceServes = false;
  const retryAt = realNow() + 15 * 60_000;
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    const path = url.split('?')[0];
    api.set(path, (api.get(path) ?? 0) + 1);
    const restricted = () => Response.json({ error: 'Binance doesn’t serve market data to this server’s region (HTTP 451).', code: 'VENUE_RESTRICTED', venue: 'binance', retryAt }, { status: 503 });
    if (path === '/api/market/binance/instruments') return binanceServes ? Response.json({ instruments: { BTC: { inst: 'BTCUSDT', contractSize: 1, priceScale: 1 } } }) : restricted();
    if (path === '/api/market/binance/tickers') return binanceServes ? Response.json({ tickers: [{ kind: 'ticker', inst: 'BTCUSDT', last: 60010, quoteVol: 2e9 }] }) : restricted();
    if (path === '/api/market/okx/instruments') return Response.json({ instruments: okxInst });
    if (path === '/api/market/okx/tickers') return Response.json({ tickers: [{ kind: 'ticker', inst: 'BTC-USDT-SWAP', last: 60000, quoteVol: 1e9, open24h: 59000 }, { kind: 'ticker', inst: 'ETH-USDT-SWAP', last: 3000, quoteVol: 5e8 }] });
    if (path === '/api/market/bitget/instruments') return Response.json({ instruments: bitgetInst });
    if (path === '/api/market/bitget/tickers') return Response.json({ tickers: [{ kind: 'ticker', inst: 'BTCUSDT', last: 60030, quoteVol: 8e8 }, { kind: 'ticker', inst: 'SOLUSDT', last: 150, quoteVol: 1e8 }] });
    if (path.includes('/klines')) return Response.json({ candles: [] });
    return Response.json({ error: 'not found' }, { status: 404 });
  }) as typeof fetch;
  const { createLiveFeed } = await import('@/lib/market/liveExchangeService');
  const feed = createLiveFeed();
  feed.configure({ primary: 'binance', compare: ['binance', 'okx', 'bitget'], focus: 'BTC' });
  feed.start();
  await sleep(300);
  FakeSocket.all.filter((s) => s.readyState === 0).forEach((s) => s.open());
  await sleep(100);
  const st = feed.getStatus();
  check('Binance (primary) shows "restricted", with the server’s next check', st.binance.state === 'error' && !!st.binance.restricted && st.binance.restricted.retryAt === retryAt, JSON.stringify(st.binance));
  check('…a plain message, not "connection failed"', /doesn’t serve market data to this server’s region/.test(st.binance.error ?? ''));
  check('OKX and Bitget load and stream regardless', feed.getListed('okx').length === 2 && feed.getListed('bitget').length === 2 && st.okx.state === 'live' && st.bitget.state === 'live', `${st.okx.state} ${st.bitget.state}`);
  check('no socket is opened for the refused venue', !FakeSocket.all.some((s) => s.url.includes('binance')));
  check('OKX quote is current (live, timestamped)', (() => { const q = feed.getQuote('okx', 'BTC'); return !!q && q.live && q.at > 0 && q.price === 60000; })());
  const binCalls = api.get('/api/market/binance/instruments') ?? 0;
  await sleep(4_500);
  check('no retry storm: the refused market list isn’t re-requested every 2–4 s', (api.get('/api/market/binance/instruments') ?? 0) === binCalls, `${binCalls} → ${api.get('/api/market/binance/instruments')}`);

  section('Browser feed — stale quotes and recovery');
  const okxTicker = FakeSocket.all.find((s) => s.url === ADAPTERS.okx.ws.tickerUrl)!;
  okxTicker.drop();
  await sleep(50);
  const qStale = feed.getQuote('okx', 'BTC');
  check('a dropped stream makes its quotes stale (not current) until new data', !!qStale && qStale.at === 0 && !qStale.live, JSON.stringify(qStale));
  feed.configure({ primary: 'okx', compare: ['binance', 'okx', 'bitget'], focus: 'BTC' });
  await sleep(50);
  check('switching the primary to OKX fills the Market Map list', feed.getMarket().length === 2 && feed.getMarket()[0].symbol === 'BTC');
  binanceServes = true;
  feed.retry('binance');
  await sleep(300);
  FakeSocket.all.filter((s) => s.readyState === 0).forEach((s) => s.open());
  await sleep(100);
  const st2 = feed.getStatus();
  check('the exchange serves again → "Check again" recovers it (no longer restricted)', !st2.binance.restricted && feed.getListed('binance').length === 1, JSON.stringify(st2.binance));
  feed.stop();

  /* ═════════════ Arbitrage ═════════════ */
  section('Arbitrage — genuine, current quotes only');
  const arb = await import('@/lib/market/arbitrage');
  const now = 1_000_000_000;
  type Q = { price: number; funding: number | null; at: number; live: boolean };
  const book: Record<string, Record<string, Q>> = {
    okx: { BTC: { price: 60000, funding: 0.0001, at: now - 1_000, live: true }, ETH: { price: 3000, funding: null, at: now - 1_000, live: true }, CAT: { price: 1, funding: null, at: now - 1_000, live: true } },
    bitget: { BTC: { price: 60300, funding: 0.0003, at: now - 2_000, live: true }, SOL: { price: 150, funding: null, at: now - 1_000, live: true }, CAT: { price: 0.02, funding: null, at: now - 1_000, live: true } },
    gate: { BTC: { price: 60150, funding: -0.0002, at: now - 500, live: true }, ETH: { price: 3010, funding: null, at: now - arb.QUOTE_MAX_AGE_MS - 1, live: true }, SOL: { price: 151, funding: null, at: 0, live: true }, CAT: { price: 1.01, funding: null, at: now - 1_000, live: true } },
    binance: { BTC: { price: 99999, funding: 0, at: now, live: true } },
  };
  const listedOf: Record<string, string[]> = { okx: ['BTC', 'ETH', 'CAT', 'DOGE'], bitget: ['BTC', 'SOL', 'CAT'], gate: ['BTC', 'ETH', 'SOL', 'CAT'], binance: [] };
  const venues = ['binance', 'okx', 'bitget', 'gate'] as const;
  const rows = arb.buildArbRows({
    venues: [...venues], available: (id) => id !== 'binance', listed: (id) => listedOf[id] ?? [],
    getQuote: (id, s) => book[id]?.[s] ?? null, now, fees: 0.001,
  });
  const row = (s: string) => rows.find((r) => r.symbol === s);
  check('rows come from every available venue — not the (refused) primary’s empty list', rows.length > 0 && !!row('SOL') && !!row('ETH'), rows.map((r) => r.symbol).join(','));
  check('a coin listed on only one venue can’t have a spread and isn’t listed', !row('DOGE'));
  check('the refused venue’s cells are "unavailable", never filled from elsewhere', rows.every((r) => r.cells[0].state === 'unavailable' && r.cells[0].quote === null));
  const btc = row('BTC')!;
  check('BTC: spread from the three genuine quotes (min OKX, max Bitget)', btc.valid === 3 && Math.abs((btc.spread ?? 0) - 300 / 60000) < 1e-12 && venues[btc.iMn] === 'okx' && venues[btc.iMx] === 'bitget');
  check('…net of fees', Math.abs((btc.net ?? 0) - (300 / 60000 - 0.001)) < 1e-12);
  check('…funding Δ only across the venues in the spread', Math.abs((btc.fundDelta ?? 0) - 0.0005) < 1e-12);
  const eth = row('ETH')!;
  check('ETH: Gate’s quote is too old → stale, so only 1 current quote → no spread', eth.cells[3].state === 'stale' && eth.spread === null && eth.valid === 1);
  const sol = row('SOL')!;
  check('SOL: a quote from before a reconnect (at 0) is stale → no spread', sol.cells[3].state === 'stale' && sol.spread === null);
  const cat = row('CAT')!;
  check('CAT: Bitget’s 0.02 is a different token (outlier) → left out, spread from OKX + Gate', cat.cells[2].state === 'outlier' && cat.valid === 2 && Math.abs((cat.spread ?? 0) - 0.01) < 1e-9);
  const offline = arb.buildArbRows({
    venues: ['okx', 'bitget'], available: () => true, listed: (id) => listedOf[id], now, fees: 0,
    getQuote: (id, s) => { const q = book[id]?.[s]; return q ? { ...q, live: id !== 'bitget' } : null; },
  });
  check('a venue whose stream is down contributes no spread (stale), even with a recent price', offline.every((r) => r.spread === null) && offline.find((r) => r.symbol === 'BTC')!.cells[1].state === 'stale');
  check('rows with a spread sort first, widest first', rows.findIndex((r) => r.spread === null) === -1 || rows.slice(0, rows.findIndex((r) => r.spread === null)).every((r, i, a) => i === 0 || (a[i - 1].spread ?? 0) >= (r.spread ?? 0)));

  /* ═════════════ Venue choice ═════════════ */
  section('Venue choice — new visitors vs. existing preferences');
  const vc = await import('@/lib/market/venueChoice');
  const refused = (id: string) => id === 'binance' || id === 'bybit';
  const futures = ['binance', 'bybit', 'okx', 'bitget', 'coinbase', 'gate'] as const;
  check('new visitor on refused Binance → switched to OKX', vc.autoVenue({ market: 'futures', current: 'binance', chosen: false, enabled: [...futures], restricted: refused }) === 'okx');
  check('…with OKX disabled in Settings → Bitget', vc.autoVenue({ market: 'futures', current: 'binance', chosen: false, enabled: ['binance', 'bybit', 'bitget', 'gate'], restricted: refused }) === 'bitget');
  check('a venue the user picked is never switched (they get a notice instead)', vc.autoVenue({ market: 'futures', current: 'binance', chosen: true, enabled: [...futures], restricted: refused }) === null);
  check('a working venue is kept', vc.autoVenue({ market: 'futures', current: 'gate', chosen: false, enabled: [...futures], restricted: refused }) === null);
  check('futures never switches to a spot venue (Coinbase)', vc.autoVenue({ market: 'futures', current: 'binance', chosen: false, enabled: ['binance', 'coinbase'], restricted: refused }) === null);
  check('spot stays on spot', vc.autoVenue({ market: 'spot', current: 'coinbase', chosen: false, enabled: [...futures], restricted: refused }) === null);
  check('default Arbitrage comparison skips refused venues (OKX, Bitget, Gate)', vc.defaultCompare('futures', refused).join() === 'okx,bitget,gate');
  check('…and is unchanged when nothing is refused', vc.defaultCompare('futures', () => false).join() === 'binance,bybit,okx,bitget');
  check('alternatives offered: working futures venues only', vc.availableVenues('futures', [...futures], refused).join() === 'okx,bitget,gate');
  const { sanitize } = await import('@/lib/market/terminalPrefs');
  check('existing users: a venue stored before this release counts as their choice', sanitize({ market: 'futures', venue: { futures: 'binance', spot: 'coinbase' } }).venueChosen.futures === true);
  check('stored flags are respected as saved', sanitize({ venue: { futures: 'binance' }, venueChosen: { futures: false, spot: false } }).venueChosen.futures === false);
  check('nothing stored → not a choice (first visit)', sanitize({}).venueChosen.futures === false);

  globalThis.fetch = realFetch;
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  const total = results.filter((x) => /^(PASS|FAIL)/.test(x)).length;
  console.log(results.join('\n'));
  console.log(`\n${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { unmute(); console.log(results.join('\n')); console.error(e); process.exit(1); });

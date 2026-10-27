/**
 * `npm run test:strategies` — the continuation-after-sweep strategies on synthetic candles:
 * no setup before the sweep, entry on the close back inside the range, the stop behind the wick's
 * extreme, failure cases, the SHORT as the LONG's exact mirror, the strength index, and the
 * lifecycle moving the stop to the wick on activation. Exits 1 on any failed check.
 */
import type { Bar } from '@/lib/indicators/calc';
import { detectAll, detectLongContinuationSweep, detectShortContinuationSweep } from '@/lib/strategies/detect';
import { advance } from '@/lib/strategies/lifecycle';
import type { Candidate } from '@/lib/strategies/types';

const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const fmt = (c: Candidate | undefined) => (c ? `${c.stage} entry ${c.entry.toFixed(3)} sl ${c.sl.toFixed(3)} tp1 ${c.tp1.toFixed(3)} strength ${c.strength?.value}` : 'none');

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 1);
type Ohlcv = [o: number, h: number, l: number, c: number, v?: number];
const toBars = (rows: readonly Ohlcv[]): Bar[] => rows.map(([o, h, l, c, v = 100], i) => ({ t: T0 + i * MIN, o, h, l, c, v }));
/** The same candles reflected through 100 (p → 200 − p): a bearish copy with identical ATR. */
const reflect = (rows: readonly Ohlcv[]): Ohlcv[] => rows.map(([o, h, l, c, v]) => [200 - o, 200 - l, 200 - h, 200 - c, v]);

/** Quiet market (ATR ≈ 0.5), a 4-candle impulse to 105.3, then a 6-candle range with equal lows at 103.6. */
function base(): Ohlcv[] {
  const rows: Ohlcv[] = [];
  for (let i = 0; i < 30; i++) {
    const up = i % 2 === 0;
    rows.push(up ? [99.9, 100.35, 99.75, 100.1] : [100.1, 100.25, 99.65, 99.9]);
  }
  rows.push([99.9, 101.3, 99.8, 101.2], [101.2, 102.6, 101.1, 102.5], [102.5, 104.0, 102.4, 103.9], [103.9, 105.3, 103.8, 105.2]);
  rows.push(
    [105.2, 105.25, 104.4, 104.5], [104.5, 104.9, 103.6, 103.8], [103.8, 104.6, 103.7, 104.4],
    [104.4, 104.7, 103.62, 103.9], [103.9, 104.5, 103.8, 104.3], [104.3, 104.6, 103.9, 104.2],
  );
  return rows;
}
const LIVE: Ohlcv = [104.0, 104.2, 103.9, 104.1]; // the still-forming candle
const ORIGIN = 99.8;

const long = (rows: Ohlcv[], lower: Bar[] | null = null) => detectLongContinuationSweep(toBars(rows), '1m', rows[rows.length - 1][3], null, lower)[0];
const short = (rows: Ohlcv[]) => detectShortContinuationSweep(toBars(rows), '1m', rows[rows.length - 1][3], null)[0];

section('Before the sweep: no trade, no stop');
check('range only: nothing', long([...base(), LIVE]) === undefined);
check('price touching the range low: nothing', long([...base(), [104.0, 104.1, 103.6, 103.7]]) === undefined, fmt(long([...base(), [104.0, 104.1, 103.6, 103.7]])));
check('the live candle wicking under the low: nothing until it closes', long([...base(), [104.0, 104.1, 103.1, 103.3]]) === undefined);

section('One-candle sweep: wick under the low, close back inside');
const oneCandle = [...base(), [104.0, 104.1, 103.0, 103.9, 300] as Ohlcv, LIVE];
const a1 = long(oneCandle);
check('ACTIVE on the close back inside', a1?.stage === 'ACTIVE' && a1.dir === 'LONG' && a1.strategy === 'longContinuationSweep', fmt(a1));
check('entry = that close (103.9)', !!a1 && near(a1.entry, 103.9));
check('SL behind the wick: below the 103.0 low by 0.1 ATR', !!a1 && a1.sl < 103.0 && a1.sl > 102.9, a1?.sl.toFixed(4));
check('SL is the wick, not the range low or the impulse origin', !!a1 && a1.sl < 103.6 && a1.sl > ORIGIN);
check('TP1 at the range high (105.3)', !!a1 && near(a1.tp1, 105.3), a1?.tp1.toFixed(3));

section('Two-candle sweep: closes outside, deepens, then reclaims');
const swept = [...base(), [104.0, 104.1, 103.0, 103.3] as Ohlcv];
const f1 = long([...swept, LIVE]);
check('swept, still outside → FORMING (trigger = range low)', f1?.stage === 'FORMING' && near(f1.entry, 103.6), fmt(f1));
check('while outside, the only level is the impulse origin (no stop at the boundary)', !!f1 && f1.sl < ORIGIN, f1?.sl.toFixed(3));
check('FORMING targets come from the wick (TP1 = range high 105.3)', !!f1 && near(f1.tp1, 105.3), f1?.tp1.toFixed(3));
const deeper = [...swept, [103.3, 103.5, 102.8, 103.2] as Ohlcv];
check('a deeper wick while outside keeps it FORMING', long([...deeper, LIVE])?.stage === 'FORMING');
const reclaimed = [...deeper, [103.2, 104.0, 103.1, 103.9] as Ohlcv, LIVE];
const a2 = long(reclaimed);
check('close back inside → ACTIVE at that close', a2?.stage === 'ACTIVE' && !!a2 && near(a2.entry, 103.9), fmt(a2));
check('SL behind the DEEPEST wick (102.8), not the first one', !!a2 && a2.sl < 102.8 && a2.sl > 102.7, a2?.sl.toFixed(4));

section('Failures');
const stuck = [...swept, [103.3, 103.5, 103.1, 103.2] as Ohlcv, [103.2, 103.5, 103.1, 103.3] as Ohlcv, [103.3, 103.5, 103.1, 103.2] as Ohlcv, LIVE];
check('no close back inside within 3 candles → cancelled', long(stuck) === undefined, fmt(long(stuck)));
const brokeOrigin = [...base(), [104.0, 104.1, 99.5, 103.9] as Ohlcv, LIVE];
check('wick through the impulse origin → cancelled', long(brokeOrigin) === undefined, fmt(long(brokeOrigin)));
const failedAfter = [...oneCandle.slice(0, -1), [103.9, 104.0, 102.8, 102.9] as Ohlcv, LIVE];
check('close back under the wick after entry → cancelled', long(failedAfter) === undefined, fmt(long(failedAfter)));
const breakout = [...base(), [104.2, 105.8, 104.1, 105.7] as Ohlcv, LIVE];
check('breaks out of the range without a sweep → nothing', long(breakout) === undefined);

section('Short continuation: the exact mirror');
const s1 = short(reflect(oneCandle));
check('ACTIVE SHORT after a wick above the range high and a close back inside', s1?.stage === 'ACTIVE' && s1.dir === 'SHORT' && s1.strategy === 'shortContinuationSweep', fmt(s1));
check('entry, SL, TP1, TP2 mirror the long exactly', !!a1 && !!s1 && near(s1.entry, 200 - a1.entry, 1e-6) && near(s1.sl, 200 - a1.sl, 1e-6) && near(s1.tp1, 200 - a1.tp1, 1e-6) && near(s1.tp2, 200 - a1.tp2, 1e-6),
  s1 && a1 ? `short sl ${s1.sl.toFixed(4)} = 200 − ${a1.sl.toFixed(4)}` : '');
check('SL above the upper wick (the 97.0 high)', !!s1 && s1.sl > 97.0, s1?.sl.toFixed(4));
check('same strength as the long', !!a1 && !!s1 && s1.strength?.value === a1.strength?.value, `${s1?.strength?.value} vs ${a1?.strength?.value}`);
check('mirrored factors read "highs" for the short', !!s1?.strength?.factors.some((f) => /equal highs/.test(f)), s1?.strength?.factors.join('; '));
const sf = short(reflect([...swept, LIVE]));
check('short FORMING while above the range high', sf?.stage === 'FORMING' && sf.dir === 'SHORT', fmt(sf));
check('no short before the sweep', short(reflect([...base(), LIVE])) === undefined);
check('long detector ignores the bearish copy, short ignores the bullish one', long(reflect(oneCandle)) === undefined && short(oneCandle) === undefined);

section('Strength index');
const quiet = long([...base(), [104.0, 104.1, 103.0, 103.9, 100], LIVE]);
const loud = long([...base(), [104.0, 104.1, 103.0, 103.9, 400], LIVE]);
check('a volume spike on the sweep raises it', !!quiet?.strength && !!loud?.strength && loud.strength.value > quiet.strength.value, `${quiet?.strength?.value} → ${loud?.strength?.value}`);
check('…and is listed as a factor', !!loud?.strength?.factors.some((f) => /sweep volume 4\.0× average/.test(f)), loud?.strength?.factors.join('; '));
check('equal lows are a factor', !!loud?.strength?.factors.some((f) => /equal lows swept/.test(f)));
check('score = strength (quality badge agrees)', !!loud && loud.score === loud.strength?.value);
check('within 0–100', [quiet, loud, a1, a2, s1].every((c) => !c?.strength || (c.strength.value >= 0 && c.strength.value <= 100)));
// Lower timeframe: 1m-like bars inside each "candle" minute — falling into the sweep, recovering after.
const lowerRows: Bar[] = [];
toBars(oneCandle).forEach((b, i) => {
  for (let k = 0; k < 4; k++) {
    const t = b.t + k * 15_000;
    const dump = i === oneCandle.length - 2 && k < 3; // the sweep candle: three falling sub-candles
    const c = dump ? b.o - (k + 1) * 0.35 : b.c;
    lowerRows.push({ t, o: c + (dump ? 0.35 : 0), h: c + 0.4, l: c - 0.05, c, v: 25 });
  }
});
const withRsi = long(oneCandle, lowerRows);
check('lower-timeframe RSI flush at the sweep counts', !!withRsi?.strength?.factors.some((f) => /^RSI 1m \d+ at the sweep/.test(f)), withRsi?.strength?.factors.join('; '));

section('detectAll & lifecycle');
const all = detectAll({ k1h: null, k5m: null, k1m: toBars(oneCandle), price: 104.1 });
check('detectAll reports the long continuation on 1m', all.some((c) => c.strategy === 'longContinuationSweep' && c.tf === '1m' && c.stage === 'ACTIVE'));
const allShort = detectAll({ k1h: null, k5m: null, k1m: toBars(reflect(oneCandle)), price: 95.9 });
check('…and the short continuation on the mirrored market', allShort.some((c) => c.strategy === 'shortContinuationSweep' && c.stage === 'ACTIVE'));
const now = T0 + 60 * MIN;
const p1 = advance('binance', [], [{ symbol: 'TEST', price: 103.3, volume24h: 1e7, candidates: [f1!] }], now);
check('lifecycle: FORMING tracked with the provisional level', p1[0]?.stage === 'FORMING' && p1[0].sl < ORIGIN);
const p2 = advance('binance', p1, [{ symbol: 'TEST', price: 102.95, volume24h: 1e7, candidates: [long([...deeper, LIVE])!] }], now + MIN);
check('a deeper sweep doesn’t invalidate it while outside', p2[0]?.stage === 'FORMING', p2[0]?.stage);
const p3 = advance('binance', p2, [{ symbol: 'TEST', price: 103.9, volume24h: 1e7, candidates: [a2!] }], now + 2 * MIN);
check('on the close back inside: ACTIVE, stop moved behind the wick, strength kept', p3[0]?.stage === 'ACTIVE' && near(p3[0].sl, a2!.sl) && p3[0].strength?.value === a2!.strength?.value, `${p3[0]?.stage} sl ${p3[0]?.sl.toFixed(4)}`);
const p4 = advance('binance', p3, [{ symbol: 'TEST', price: 102.6, volume24h: 1e7, candidates: [] }], now + 3 * MIN);
check('price through the wick stop → INVALIDATED', p4[0]?.stage === 'INVALIDATED');

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
const total = results.filter((r) => /^(PASS|FAIL) /.test(r)).length;
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed ? 1 : 0);

import { fmtPrice } from './format';
import type { Candle, CandleGeometry } from './market/types';

export function normalize(values: number[], w: number, h: number, pad: number): Array<[number, number]> {
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const r = mx - mn || 1;
  return values.map((v, i) => [(i / (values.length - 1)) * w, pad + (1 - (v - mn) / r) * (h - pad * 2)]);
}

export const sparkPoints = (values: number[], w: number, h: number): string =>
  normalize(values, w, h, 2).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export function areaPaths(values: number[], w: number, h: number): { line: string; area: string } {
  const pts = normalize(values, w, h, 6);
  const line = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

/** SVG path geometry for a 600×266 candlestick + volume chart. */
export function candleGeometry(c: Candle[]): CandleGeometry {
  const W = 600, H = 220, VH = 40;
  const hi = Math.max(...c.map((x) => x.h));
  const lo = Math.min(...c.map((x) => x.l));
  const range = hi - lo || 1;
  const step = W / c.length;
  const bw = Math.max(1, step * 0.62);
  const vMax = Math.max(...c.map((x) => x.v));
  const y = (v: number): number => ((hi - v) / range) * (H - 8) + 4;
  const g = { upWick: '', upBody: '', downWick: '', downBody: '', upVol: '', downVol: '' };
  c.forEach((k, j) => {
    const x = j * step + step / 2;
    const wick = `M${x.toFixed(1)} ${y(k.h).toFixed(1)}V${y(k.l).toFixed(1)}`;
    const y0 = y(Math.max(k.o, k.c));
    const y1 = Math.max(y(Math.min(k.o, k.c)), y0 + 1);
    const body = `M${(x - bw / 2).toFixed(1)} ${y0.toFixed(1)}h${bw.toFixed(1)}V${y1.toFixed(1)}h${(-bw).toFixed(1)}Z`;
    const vh = (k.v / vMax) * VH;
    const vol = `M${(x - bw / 2).toFixed(1)} ${H + VH + 6}h${bw.toFixed(1)}v${(-vh).toFixed(1)}h${(-bw).toFixed(1)}Z`;
    if (k.c >= k.o) { g.upWick += wick; g.upBody += body; g.upVol += vol; }
    else { g.downWick += wick; g.downBody += body; g.downVol += vol; }
  });
  const lc = c[c.length - 1].c;
  return { ...g, lastY: y(lc), high: fmtPrice(hi), low: fmtPrice(lo), last: fmtPrice(lc), change: lc / c[0].o - 1 };
}

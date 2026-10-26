/** Drawings persisted per browser, keyed by exchange + symbol and shared across timeframes. */
import { createListStore } from '@/lib/alerts/localStore';
import { isExchangeId } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { DRAWING_KINDS, LINE_STYLES } from './types';
import type { Drawing } from './types';

const isDrawing = (v: unknown): v is Drawing => {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Partial<Drawing>;
  return typeof d.id === 'string' && typeof d.exchange === 'string' && isExchangeId(d.exchange)
    && typeof d.symbol === 'string' && typeof d.kind === 'string' && DRAWING_KINDS.includes(d.kind)
    && Array.isArray(d.points) && d.points.every((p) => typeof p?.time === 'number' && typeof p?.price === 'number')
    && (d.text === undefined || typeof d.text === 'string')
    && typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color)
    && (d.width === undefined || (typeof d.width === 'number' && d.width >= 0.5 && d.width <= 8))
    && (d.style === undefined || LINE_STYLES.includes(d.style))
    && (d.locked === undefined || typeof d.locked === 'boolean');
};

export const drawingStore = createListStore<Drawing>('screenerix.drawings.v1', isDrawing);

export function upsertDrawing(d: Drawing): void {
  const all = drawingStore.getSnapshot();
  drawingStore.set(all.some((x) => x.id === d.id) ? all.map((x) => (x.id === d.id ? d : x)) : [...all, d]);
}

export function removeDrawing(id: string): void {
  drawingStore.set(drawingStore.getSnapshot().filter((d) => d.id !== id));
}

export function removeAllDrawings(exchange: ExchangeId, symbol: string): void {
  drawingStore.set(drawingStore.getSnapshot().filter((d) => !(d.exchange === exchange && d.symbol === symbol)));
}

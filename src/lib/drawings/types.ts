import type { ExchangeId } from '@/lib/market/exchanges';

export type DrawingKind =
  | 'trend' | 'ray' | 'extended' | 'hline' | 'hray' | 'vline'
  | 'fib' | 'rect' | 'ellipse' | 'arrow' | 'brush'
  | 'priceRange' | 'ruler' | 'text';

/** Anchored in market coordinates so a drawing survives zoom, scroll and timeframe changes. */
export interface DrawPoint {
  /** ms since epoch (may lie beyond the last candle). */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  exchange: ExchangeId;
  symbol: string;
  kind: DrawingKind;
  points: DrawPoint[];
  color: string;
  /** Note shown by `text` drawings. */
  text?: string;
  /** Stroke width (px); default 1.5. */
  width?: number;
  /** Stroke pattern; default solid. */
  style?: LineStyleId;
  /** Locked: can be selected and restyled, not moved or reshaped. */
  locked?: boolean;
  createdAt: number;
}

export type LineStyleId = 'solid' | 'dashed' | 'dotted';
export const LINE_STYLES: readonly LineStyleId[] = ['solid', 'dashed', 'dotted'];
export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 4];
export const DEFAULT_WIDTH = 1.5;
/** Context-toolbar palette. */
export const DRAWING_PALETTE: readonly string[] = ['#5B9DFF', '#30A46C', '#E5484D', '#F5C542', '#F5A524', '#B48CFF', '#2EC4C4', '#EDEEF0', '#8B8D98'];
/** SVG dash pattern for a style at a stroke width. */
export const dashArray = (style: LineStyleId | undefined, w: number): string | undefined =>
  style === 'dashed' ? `${w * 4} ${w * 3}` : style === 'dotted' ? `${w} ${w * 2}` : undefined;

/** How a tool is placed: one click, two clicks (or press-drag), or a freehand drag. */
export const PLACEMENT: Record<DrawingKind, 'single' | 'double' | 'drag'> = {
  trend: 'double', ray: 'double', extended: 'double', hline: 'single', hray: 'single', vline: 'single',
  fib: 'double', rect: 'double', ellipse: 'double', arrow: 'double', brush: 'drag',
  priceRange: 'double', ruler: 'double', text: 'single',
};

export const DRAWING_LABEL: Record<DrawingKind, string> = {
  trend: 'Trend line', ray: 'Ray', extended: 'Extended line', hline: 'Horizontal line', hray: 'Horizontal ray', vline: 'Vertical line',
  fib: 'Fib retracement', rect: 'Rectangle', ellipse: 'Ellipse', arrow: 'Arrow', brush: 'Brush',
  priceRange: 'Price range', ruler: 'Date & price range', text: 'Text',
};

export const DEFAULT_COLOR: Record<DrawingKind, string> = {
  trend: '#5B9DFF', ray: '#5B9DFF', extended: '#5B9DFF', hline: '#5B9DFF', hray: '#5B9DFF', vline: '#5B9DFF',
  fib: '#8B8D98', rect: '#B48CFF', ellipse: '#B48CFF', arrow: '#F5C542', brush: '#EDEEF0',
  priceRange: '#5B9DFF', ruler: '#5B9DFF', text: '#EDEEF0',
};

export const DRAWING_KINDS = Object.keys(PLACEMENT) as DrawingKind[];

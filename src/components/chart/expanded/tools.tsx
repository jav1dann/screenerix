import type { ComponentType } from 'react';
import {
  ArrowRightFromLine, ArrowUpRight, BellPlus, Brush, Circle, Crosshair, Dot, Minus, MousePointer2, MoveUpRight,
  Ruler, RulerDimensionLine, SeparatorVertical, Slash, Spline, Square, MoveVertical, Type,
} from 'lucide-react';
import { DRAWING_LABEL } from '@/lib/drawings/types';
import type { DrawingKind } from '@/lib/drawings/types';

export type CursorTool = 'cross' | 'dot' | 'pointer';
export type Tool = CursorTool | DrawingKind | 'alert' | 'measure';

export const isCursor = (t: Tool): t is CursorTool => t === 'cross' || t === 'dot' || t === 'pointer';
export const isDrawingTool = (t: Tool): t is DrawingKind => !isCursor(t) && t !== 'alert' && t !== 'measure';

export const TOOL_LABEL: Record<Tool, string> = {
  cross: 'Cross', dot: 'Dot', pointer: 'Arrow', alert: 'Price alert', measure: 'Measure',
  ...DRAWING_LABEL,
};

type IconProps = { size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' };

/** Trend line: a segment between two anchor points. */
function TrendSegment({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...rest}>
      <line x1="6.5" y1="17.5" x2="17.5" y2="6.5" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
    </svg>
  );
}

export const TOOL_ICON: Record<Tool, ComponentType<IconProps>> = {
  cross: Crosshair, dot: Dot, pointer: MousePointer2, alert: BellPlus, measure: Ruler,
  trend: TrendSegment, ray: MoveUpRight, extended: Slash, hline: Minus, hray: ArrowRightFromLine, vline: SeparatorVertical,
  fib: Spline, rect: Square, ellipse: Circle, arrow: ArrowUpRight, brush: Brush,
  priceRange: MoveVertical, ruler: RulerDimensionLine, text: Type,
};

export interface ToolGroup { id: string; label: string; tools: Tool[] }

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'cursor', label: 'Cursors', tools: ['cross', 'dot', 'pointer'] },
  // The trend line (segment) has its own button; rays and level lines share the flyout.
  { id: 'trend', label: 'Trend line', tools: ['trend'] },
  { id: 'lines', label: 'Lines', tools: ['hline', 'ray', 'extended', 'hray', 'vline'] },
  { id: 'fib', label: 'Fibonacci & geometry', tools: ['fib', 'rect', 'ellipse'] },
  { id: 'brush', label: 'Brush & shapes', tools: ['brush', 'arrow'] },
  { id: 'text', label: 'Text & notes', tools: ['text'] },
  { id: 'measure', label: 'Measure', tools: ['priceRange', 'ruler'] },
];

export function ToolIcon({ tool, size = 16 }: { tool: Tool; size?: number }) {
  const I = TOOL_ICON[tool];
  return <I size={size} strokeWidth={1.75} aria-hidden="true" />;
}

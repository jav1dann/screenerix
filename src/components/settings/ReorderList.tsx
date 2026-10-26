'use client';

/** Orderable list: drag a row (mouse) or use its ↑ / ↓ buttons (keyboard). */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { ICON_BTN } from '@/components/chart/styles';

interface ReorderListProps<T extends string> {
  label: string;
  items: readonly T[];
  render: (id: T) => ReactNode;
  onChange: (next: T[]) => void;
  /** Extra controls at the end of a row (e.g. a remove button). */
  trailing?: (id: T) => ReactNode;
  /** Rows shown dimmed (e.g. disabled buttons). */
  dimmed?: (id: T) => boolean;
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

export default function ReorderList<T extends string>({ label, items, render, onChange, trailing, dimmed }: ReorderListProps<T>) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (!items.length) return <p className="m-0 rounded-lg border border-dashed border-sx-line px-3 py-4 text-center text-xs text-sx-muted">Nothing selected.</p>;
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((id, i) => (
        <li
          key={id}
          draggable
          data-item={id}
          onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(i); }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) onChange(move(items, drag, i)); setDrag(null); setOver(null); }}
          onDragEnd={() => { setDrag(null); setOver(null); }}
          className={`flex items-center gap-2 rounded-lg border border-solid px-2 py-1 text-[13px] transition-colors ${
            over === i && drag !== i ? 'border-sx-up/60 bg-sx-up/10' : 'border-sx-line bg-white/[0.02]'
          } ${drag === i ? 'opacity-50' : ''} ${dimmed?.(id) ? 'text-sx-muted' : ''}`}
        >
          <GripVertical size={14} className="shrink-0 cursor-grab text-[#55585F]" aria-hidden="true" />
          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-sx-muted">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{render(id)}</span>
          {trailing?.(id)}
          <button type="button" className={ICON_BTN} disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))} aria-label={`Move ${id} up`} title="Move up">
            <ArrowUp size={13} aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BTN} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))} aria-label={`Move ${id} down`} title="Move down">
            <ArrowDown size={13} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  );
}

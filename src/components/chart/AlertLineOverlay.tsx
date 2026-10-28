'use client';

/**
 * Price-alert lines' interactive layer, shared by the chart card and the expanded chart: a popup
 * above each line (Save for a just-placed line, Edit, Delete) and a strip along the line that can
 * be dragged up / down — the price follows the pointer live and is saved on release.
 * The canvas line itself is drawn by the chart; `onPreview` moves it while dragging.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { IconAlarm, IconPencil, IconTrash } from '@/components/shared/icons';
import { fmtPrice } from '@/lib/format';
import type { AlertLine } from './ChartCanvas';
import { BTN_RESET } from './styles';

/** Drag distance (px) below which a press on the line is a click, not a move. */
const DRAG_PX = 3;
/** Prices from a pointer position: six significant digits are plenty for any coin. */
const tidy = (p: number) => +p.toPrecision(6);

export interface AlertLineOverlayProps {
  lines: readonly AlertLine[];
  /** Each line's pixel row in this layer (null / missing: off the price scale). */
  ys: Readonly<Record<string, number | null>>;
  /** Price at a pixel row of this layer (called while dragging). */
  priceAt(y: number): number | null;
  /** Layer height: lines outside it are not shown. */
  height: number;
  /** Save a just-placed (draft) line as a real alert; resolves to an error message or null. */
  onSave(id: string): Promise<string | null>;
  /** Commit a dragged line at `price`; resolves to an error message or null. */
  onMove(id: string, price: number): Promise<string | null>;
  /** Move the drawn line while dragging (null: back to its own price). */
  onPreview(id: string, price: number | null): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  /** Stacking within the chart (the expanded chart's drawing layer sits higher). */
  z?: number;
}

export default function AlertLineOverlay({ lines, ys, priceAt, height, onSave, onMove, onPreview, onEdit, onDelete, z = 10 }: AlertLineOverlayProps) {
  const layer = useRef<HTMLDivElement>(null);
  /** The line being dragged: its live price and pixel row (the pointer's). */
  const [drag, setDrag] = useState<{ id: string; price: number; y: number; moved: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const press = useRef<{ id: string; y0: number } | null>(null);

  const rowOf = (e: ReactPointerEvent) => e.clientY - (layer.current?.getBoundingClientRect().top ?? 0);
  const setError = (id: string, text: string | null) => setErrors((prev) => {
    const next = { ...prev };
    if (text) next[id] = text; else delete next[id];
    return next;
  });

  const onDown = (e: ReactPointerEvent<HTMLDivElement>, l: AlertLine) => {
    if (e.button !== 0 || busy) return;
    e.preventDefault();
    e.stopPropagation(); // not a chart pan / click
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id: l.id, y0: rowOf(e) };
    setDrag({ id: l.id, price: l.price, y: ys[l.id] ?? rowOf(e), moved: false });
  };
  const onMovePointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || !drag) return;
    const y = Math.max(2, Math.min(height - 2, rowOf(e)));
    if (!drag.moved && Math.abs(y - p.y0) < DRAG_PX) return;
    const price = priceAt(y);
    if (price === null || !(price > 0)) return;
    const next = tidy(price);
    setDrag({ id: p.id, price: next, y, moved: true });
    onPreview(p.id, next);
  };
  const onUp = async (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = drag;
    if (!p || !d || !d.moved) { setDrag(null); return; }
    setBusy(p.id);
    setError(p.id, null);
    const err = await onMove(p.id, d.price);
    setBusy(null);
    setDrag(null);
    onPreview(p.id, null); // the line now follows the saved (or, on error, the old) price
    if (err) setError(p.id, err);
  };

  const save = async (id: string) => {
    setBusy(id);
    setError(id, null);
    const err = await onSave(id);
    setBusy(null);
    if (err) setError(id, err);
  };

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0" style={{ zIndex: z }} data-alert-overlay>
      {lines.map((l) => {
        const price = drag?.id === l.id ? drag.price : l.price;
        const y = drag?.id === l.id && drag.moved ? drag.y : ys[l.id];
        if (y === null || y === undefined || y < 0 || y > height) return null;
        const dragging = drag?.id === l.id && drag.moved;
        const error = errors[l.id];
        return (
          <div key={l.id}>
            {/* Grab strip along the line. */}
            <div
              role="slider"
              aria-label={`${l.draft ? 'New' : 'Price'} alert at ${fmtPrice(price)} — drag to move`}
              aria-valuenow={price}
              aria-orientation="vertical"
              title="Drag to move the alert"
              className="pointer-events-auto absolute left-0 right-0 cursor-ns-resize touch-none"
              style={{ top: y - 4, height: 9 }}
              onPointerDown={(e) => onDown(e, l)}
              onPointerMove={onMovePointer}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              data-alert-drag={l.id}
            />
            {y >= 18 && (
              <div
                className={`pointer-events-auto absolute left-2 flex items-center gap-1.5 rounded-md border border-solid bg-[#1A1710]/95 py-0.5 pl-2 pr-0.5 text-[11px] text-sx-alert shadow-lg shadow-black/40 ${dragging ? 'border-sx-alert' : 'border-sx-alert/50'}`}
                style={{ top: y - 24 }}
                data-alert-popup={l.id}
              >
                <IconAlarm />
                <span className="font-semibold">Price alert</span>
                <span className="tabular-nums text-sx-text/80" data-alert-price>{fmtPrice(price)}</span>
                {busy === l.id && <span className="text-[10px] text-sx-muted">Saving…</span>}
                {l.draft && busy !== l.id && (
                  <button type="button" className={`${BTN_RESET} rounded bg-sx-alert px-1.5 py-px text-[10px] font-bold text-[#1A1710] hover:bg-[#FFD866]`} onClick={() => void save(l.id)} title="Save this alert" data-alert-save>
                    Save
                  </button>
                )}
                {!l.active && !l.draft && <span className="rounded bg-white/10 px-1 text-[10px] text-sx-muted">triggered</span>}
                {error && <span className="max-w-56 truncate text-[10px] text-sx-down" role="alert" title={error} data-alert-error>{error}</span>}
                <button type="button" className={`${BTN_RESET} grid h-5 w-5 place-items-center rounded hover:bg-sx-alert/15`} onClick={() => onEdit(l.id)} aria-label="Edit alert" title="Edit alert">
                  <IconPencil />
                </button>
                <button type="button" className={`${BTN_RESET} grid h-5 w-5 place-items-center rounded hover:bg-sx-down/20 hover:text-sx-down`} onClick={() => onDelete(l.id)} aria-label={l.draft ? 'Discard alert' : 'Delete alert'} title={l.draft ? 'Discard' : 'Delete alert'}>
                  <IconTrash />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

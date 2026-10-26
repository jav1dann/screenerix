'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  /** Renders the trigger; call `toggle` from its onClick. */
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  /** Where the panel opens relative to the trigger. */
  placement?: 'bottom-end' | 'bottom-start' | 'right-start';
  /**
   * Render the panel in a fixed-position portal. Use inside scrolling or
   * `overflow` containers that would otherwise clip it.
   */
  portal?: boolean;
  className?: string;
}

const PLACEMENT = {
  'bottom-end': 'right-0 top-[calc(100%+6px)]',
  'bottom-start': 'left-0 top-[calc(100%+6px)]',
  'right-start': 'left-[calc(100%+6px)] top-0',
} as const;

const PANEL = 'z-[60] rounded-xl border border-solid border-sx-line2 bg-[#14151A]/97 p-1.5 text-[13px] text-sx-text shadow-2xl shadow-black/60 backdrop-blur-xl';

/** Pin a portalled panel next to its trigger (fixed coordinates from the trigger's box). */
function placeFixed(panel: HTMLElement, rect: DOMRect, placement: NonNullable<PopoverProps['placement']>): void {
  const s = panel.style;
  s.position = 'fixed';
  if (placement === 'right-start') { s.top = `${rect.top}px`; s.left = `${rect.right + 6}px`; return; }
  s.top = `${rect.bottom + 6}px`;
  if (placement === 'bottom-end') s.right = `${window.innerWidth - rect.right}px`;
  else s.left = `${rect.left}px`;
}

/** Small dropdown panel that closes on outside click and Escape. */
export default function Popover({ trigger, children, placement = 'bottom-end', portal = false, className = '' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (t: EventTarget | null) => t instanceof Node && (ref.current?.contains(t) || panelRef.current?.contains(t));
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // don't also close the surrounding dialog
      setOpen(false);
    };
    // A portalled panel can't follow its trigger, so close it if anything scrolls or resizes.
    const onMove = (e: Event) => { if (!(e.target instanceof Node && panelRef.current?.contains(e.target))) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    if (portal) {
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
    }
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, portal]);

  const close = () => setOpen(false);
  const toggle = () => setOpen((o) => !o);
  const attachPanel = (el: HTMLDivElement | null) => {
    panelRef.current = el;
    if (el && portal && ref.current) placeFixed(el, ref.current.getBoundingClientRect(), placement);
  };

  const panel = (
    <div
      ref={attachPanel}
      role="menu"
      className={`${portal ? '' : `absolute ${PLACEMENT[placement]}`} ${PANEL} ${className}`}
    >
      {children(close)}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      {trigger(open, toggle)}
      {open && (portal ? createPortal(panel, document.body) : panel)}
    </div>
  );
}

'use client';

/** Dialog shell of the Strategies modals (Esc closes the topmost one without reaching the terminal). */
import { useEffect, useEffectEvent, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { BTN_RESET, ICON_BTN } from '@/components/chart/styles';

export default function Modal({ title, icon, onClose, children, footer, maxWidth = 720, height, data }: {
  title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; maxWidth?: number; height?: string; data: string;
}) {
  const id = useId();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center p-3 text-sx-text md:p-6 [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label={`Close ${title}`} onClick={onClose} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        {...{ [`data-${data}`]: '' }}
        className="relative flex max-h-[calc(100vh-24px)] w-full flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
        style={{ maxWidth, height }}
      >
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3.5">
          {icon}
          <h2 id={`${id}-title`} className="m-0 truncate text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`${ICON_BTN} ml-auto`}><X size={16} aria-hidden="true" /></button>
        </div>
        {children}
        {footer && <div className="flex items-center gap-2 border-0 border-t border-solid border-sx-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

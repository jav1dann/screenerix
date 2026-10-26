'use client';

/** Shared shell for the Densities modals: title bar, tab strip, body and footer. Esc closes. */
import { useEffect, useEffectEvent, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { BTN_RESET, ICON_BTN } from '@/components/chart/styles';

interface DensityModalProps<T extends string> {
  title: string;
  icon: ReactNode;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  tab: T;
  onTab: (t: T) => void;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

export default function DensityModal<T extends string>({ title, icon, tabs, tab, onTab, onClose, footer, children }: DensityModalProps<T>) {
  const ids = useId();
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
    <div className="fixed inset-0 z-[115] grid place-items-center p-4 text-sx-text [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm`} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#111215]/95 shadow-2xl shadow-black/70 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3.5">
          <span className="text-sx-muted" aria-hidden="true">{icon}</span>
          <h2 id={`${ids}-title`} className="m-0 text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`${ICON_BTN} ml-auto`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div role="tablist" aria-label={`${title} sections`} className="sx-noscroll flex gap-1 overflow-x-auto border-0 border-b border-solid border-sx-line px-4 py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`${BTN_RESET} shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t.id ? 'bg-white/10 text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="sx-scroll min-h-[300px] flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center gap-2 border-0 border-t border-solid border-sx-line px-5 py-3">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

export { ColorInput, Field, NumberInput } from '@/components/shared/form';

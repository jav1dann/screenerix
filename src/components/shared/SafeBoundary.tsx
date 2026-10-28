'use client';

/**
 * Error boundary for one part of the terminal (a module, a chart card, the expanded chart):
 * a failure there shows a small panel with the error and "Try again" instead of taking the
 * whole page down. "Reset saved layout" clears this browser's saved terminal settings (not
 * drawings) in case a stored value is what breaks it.
 *
 *   <SafeBoundary name="Market Map">…</SafeBoundary>
 *   <SafeBoundary name="ETH chart" compact>…</SafeBoundary>
 */
import { catchError } from 'next/error';
import type { ErrorInfo } from 'next/error';
import { useEffect } from 'react';
import { resetSavedLayout } from '@/lib/settings/resetLayout';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';

function Fallback({ name, compact = false, onClose }: { name: string; compact?: boolean; /** In a dialog: a Close button (its own Escape handling may be what failed). */ onClose?: () => void }, { error, reset }: ErrorInfo) {
  useEffect(() => { console.error(`[screenerix] ${name} crashed:`, error); }, [name, error]);
  return (
    <div
      role="alert"
      className={`sx-glass flex flex-col items-center justify-center gap-2 text-center ${compact ? 'h-full min-h-24 p-3 text-[11px]' : 'min-h-40 p-6 text-[13px]'}`}
      data-error-boundary={name}
    >
      <b className="text-sx-text">{name} couldn’t be shown</b>
      <span className="max-w-full break-words text-sx-muted" data-error-message>{errorText(error)}</span>
      <span className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="sx-btn" onClick={() => reset()} data-error-retry>Try again</button>
        {onClose && <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose} data-error-close>Close</button>}
        {!compact && <button type="button" className="sx-btn sx-btn-ghost" onClick={resetSavedLayout} title="Clears this browser’s saved terminal settings (drawings and alerts are kept), then reloads" data-error-reset-layout>Reset saved layout</button>}
      </span>
    </div>
  );
}

export default catchError(Fallback);

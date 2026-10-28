'use client';

/**
 * Page-level error screen (app/error.tsx, app/terminal/error.tsx): what failed, "Try again"
 * (re-renders the page without reloading it) and, for the terminal, "Reset saved layout" —
 * never an automatic reload, so a persistent error can't turn into a reload loop.
 */
import Link from 'next/link';
import { useEffect } from 'react';
import { resetSavedLayout } from '@/lib/settings/resetLayout';

export default function RouteError({ error, retry, area, layoutReset = false }: { error: unknown; retry: () => void; area: string; layoutReset?: boolean }) {
  useEffect(() => { console.error(`[screenerix] ${area} crashed:`, error); }, [area, error]);
  const message = (error instanceof Error ? error.message : String(error)) || 'Unknown error';
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: unknown }).digest ?? '') : '';
  return (
    <main className="sx-root flex min-h-screen items-center justify-center p-6" style={{ background: '#0B0C0E' }} data-route-error={area}>
      <div role="alert" className="sx-glass flex max-w-lg flex-col items-center gap-3 p-8 text-center">
        <h1 className="m-0 text-lg font-bold text-sx-text">The {area} ran into an error</h1>
        <p className="m-0 break-words text-[13px] text-sx-muted" data-error-message>{message}{digest ? ` (ref ${digest})` : ''}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="sx-btn" onClick={() => retry()} data-error-retry>Try again</button>
          {layoutReset && <button type="button" className="sx-btn sx-btn-ghost" onClick={resetSavedLayout} title="Clears this browser’s saved terminal settings (drawings and alerts are kept), then reloads" data-error-reset-layout>Reset saved layout</button>}
          <Link className="sx-btn sx-btn-ghost" href="/">Home</Link>
        </div>
      </div>
    </main>
  );
}

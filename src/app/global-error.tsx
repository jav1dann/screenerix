'use client';

/**
 * Errors in the root layout itself: replaces the whole document (no global CSS here, hence the
 * inline styles). "Try again" re-renders; nothing reloads on its own.
 */
import Link from 'next/link';

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = (error instanceof Error ? error.message : String(error)) || 'Unknown error';
  const button = { padding: '8px 14px', borderRadius: 10, border: '1px solid #2A2D33', background: '#16181C', color: '#EDEEF0', cursor: 'pointer', font: 'inherit', textDecoration: 'none' };
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B0C0E', color: '#EDEEF0', fontFamily: 'system-ui, sans-serif' }}>
        <title>Screenerix — error</title>
        <div role="alert" style={{ maxWidth: 480, padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Screenerix ran into an error</h1>
          <p style={{ fontSize: 13, color: '#8B8F98', margin: '0 0 16px', wordBreak: 'break-word' }}>{message}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" style={button} onClick={() => retry()}>Try again</button>
            <Link style={button} href="/">Home</Link>
          </div>
        </div>
      </body>
    </html>
  );
}

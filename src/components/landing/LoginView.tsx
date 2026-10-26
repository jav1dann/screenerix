'use client';

/** Full-page Sign in / Register (where the terminal guard sends signed-out visitors). */
import { useState } from 'react';
import Link from 'next/link';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import type { AuthMode } from '@/lib/landing/content';
import { COLORS } from '@/lib/theme';
import AuthForm from './AuthForm';

export default function LoginView({ initialMode, next, gated, googleEnabled = false, oauthError = null }: {
  initialMode: AuthMode;
  next: string;
  gated: boolean;
  /** Google Sign-In is configured on the server. */
  googleEnabled?: boolean;
  /** Friendly message for a failed Google sign-in (`?error=google_…`). */
  oauthError?: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  return (
    <main className="lx-root" style={{ position: 'relative', overflow: 'hidden', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: -180, width: 1100, height: 700, transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(48,164,108,0.13), transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', width: 'min(420px,100%)', display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 16, background: 'rgba(17,18,21,0.88)', border: `1px solid ${COLORS.line2}`, boxShadow: '0 40px 120px rgba(0,0,0,0.7)' }}>
        <Link href="/" aria-label="Screenerix home" style={{ alignSelf: 'flex-start' }}><ScreenerixLogo size={26} fontSize={14} /></Link>
        {gated && (
          <p role="status" data-gated style={{ margin: 0, fontSize: 13, padding: '8px 10px', borderRadius: 8, background: COLORS.upBg, color: COLORS.up }}>
            Sign in or create an account to open the terminal.
          </p>
        )}
        <AuthForm mode={mode} onModeChange={setMode} next={next} autoFocus googleEnabled={googleEnabled} oauthError={oauthError} />
      </div>
    </main>
  );
}

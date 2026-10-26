'use client';

import { useEffect, useEffectEvent } from 'react';
import { IconX } from '@/components/shared/icons';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import type { AuthMode } from '@/lib/landing/content';
import { authEn } from '@/lib/landing/i18n/authEn';
import type { Dict } from '@/lib/landing/i18n/en';
import { COLORS } from '@/lib/theme';
import AuthForm from './AuthForm';

interface AuthModalProps {
  mode: AuthMode;
  onModeChange: (m: AuthMode) => void;
  onClose: () => void;
  /** Google Sign-In is configured on the server. */
  googleEnabled?: boolean;
  /** Labels in the page's language. */
  t?: Dict['auth'];
  /** Where to land after signing in / registering (default: the terminal). */
  next?: string;
}

/** Sign in / Register over the landing page (Google, or email + password). */
export default function AuthModal({ mode, onModeChange, onClose, googleEnabled = false, t = authEn, next }: AuthModalProps) {
  const onEscape = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); });
  useEffect(() => {
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label={mode === 'register' ? t.register : t.signIn} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <button aria-label={t.close} onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, cursor: 'default' }} />
      <div style={{ position: 'relative', width: 'min(420px,100%)', display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 16, background: 'rgba(17,18,21,0.88)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: `1px solid ${COLORS.line2}`, boxShadow: '0 40px 120px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ScreenerixLogo size={26} fontSize={14} />
          <button className="lx-icon-btn" onClick={onClose} aria-label={t.close} style={{ marginLeft: 'auto' }}><IconX /></button>
        </div>
        <AuthForm mode={mode} onModeChange={onModeChange} autoFocus googleEnabled={googleEnabled} t={t} next={next} />
      </div>
    </div>
  );
}

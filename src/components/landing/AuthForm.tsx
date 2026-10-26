'use client';

/**
 * Sign in / Register with Google (when configured) or email and password (server actions).
 * Shared by the landing modal and the /login page; success redirects to `next` (the terminal).
 * Registering requires accepting the Terms and Privacy Policy (checked again on the server).
 */
import { useActionState, useState } from 'react';
import type { ReactNode } from 'react';
import { register, signIn } from '@/app/actions/auth';
import type { AuthState } from '@/app/actions/auth';
import type { AuthMode } from '@/lib/landing/content';
import { authEn } from '@/lib/landing/i18n/authEn';
import type { Dict } from '@/lib/landing/i18n/en';
import { fillParts } from '@/lib/landing/i18n/locales';
import { COLORS } from '@/lib/theme';
import GoogleButton from './GoogleButton';

const INITIAL: AuthState = { error: null };

/** "I agree to the {terms} and the {privacy}" with both slots as links (opening in a new tab). */
function Consent({ template, t }: { template: string; t: AuthCopy }): ReactNode {
  return fillParts(template, {
    terms: <a key="t" href="/terms" target="_blank" rel="noopener">{t.terms}</a>,
    privacy: <a key="p" href="/privacy" target="_blank" rel="noopener">{t.privacy}</a>,
  });
}

type AuthCopy = Dict['auth'];

export default function AuthForm({ mode, onModeChange, next = '/terminal', autoFocus = false, googleEnabled = false, oauthError, t = authEn }: {
  mode: AuthMode;
  onModeChange: (m: AuthMode) => void;
  next?: string;
  autoFocus?: boolean;
  /** Google Sign-In is configured on the server (shows "Continue with Google"). */
  googleEnabled?: boolean;
  /** Why the last Google sign-in failed (from /login?error=…). */
  oauthError?: string | null;
  /** Labels in the page's language (English by default). */
  t?: AuthCopy;
}) {
  const isRegister = mode === 'register';
  const [signInState, signInAction, signingIn] = useActionState(signIn, INITIAL);
  const [registerState, registerAction, registering] = useActionState(register, INITIAL);
  const [agreed, setAgreed] = useState(false);
  const state = isRegister ? registerState : signInState;
  const pending = isRegister ? registering : signingIn;
  const blocked = isRegister && !agreed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-auth-form={mode}>
      <div className="lx-seg" role="tablist" aria-label={t.account}>
        <button type="button" role="tab" aria-selected={!isRegister} className="lx-seg-opt" data-active={!isRegister} onClick={() => onModeChange('signin')}>{t.signIn}</button>
        <button type="button" role="tab" aria-selected={isRegister} className="lx-seg-opt" data-active={isRegister} onClick={() => onModeChange('register')}>{t.register}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 style={{ fontSize: 20 }}>{isRegister ? t.registerTitle : t.signInTitle}</h3>
        <span className="lx-muted" style={{ fontSize: 13 }}>{isRegister ? t.registerSub : t.signInSub}</span>
      </div>
      {isRegister && (
        <label className="lx-check" data-terms-consent>
          {/* Unlocks the Google button and the email form; the form posts it as a hidden field
              (React resets a form after its action, which would untick a form-owned checkbox). */}
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span><Consent template={t.agree} t={t} /></span>
        </label>
      )}
      {googleEnabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GoogleButton next={next} label={isRegister ? t.googleSignUp : t.google} redirectingLabel={t.googleRedirecting} disabled={blocked} />
          {oauthError && !state.error && <span role="alert" data-oauth-error style={{ fontSize: 13, color: COLORS.down }}>{oauthError}</span>}
          <span className="lx-or">{t.orEmail}</span>
        </div>
      )}
      {!googleEnabled && oauthError && <span role="alert" data-oauth-error style={{ fontSize: 13, color: COLORS.down }}>{oauthError}</span>}
      {/* `key` remounts the form per mode, so fields reset when switching tabs. */}
      <form key={mode} action={isRegister ? registerAction : signInAction} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input type="hidden" name="next" value={next} />
        {isRegister && <input type="hidden" name="terms" value={agreed ? 'on' : ''} />}
        {isRegister && (
          <input className="lx-input" name="name" placeholder={t.name} aria-label={t.name} autoComplete="name" defaultValue={state.name ?? ''} autoFocus={autoFocus} required />
        )}
        <input className="lx-input" name="email" type="email" placeholder="you@fund.com" aria-label={t.email} autoComplete="email" defaultValue={state.email ?? ''} autoFocus={autoFocus && !isRegister} required />
        <input className="lx-input" name="password" type="password" placeholder={isRegister ? t.passwordNew : t.password} aria-label={t.password} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} required />
        {state.error && <span role="alert" style={{ fontSize: 13, color: COLORS.down }}>{state.error}</span>}
        <button type="submit" className="lx-btn lx-btn-primary" disabled={pending || blocked} aria-busy={pending}>
          {pending ? (isRegister ? t.creating : t.signingIn) : isRegister ? t.submitRegister : t.submitSignIn}
        </button>
      </form>
      {!isRegister && <p className="lx-muted lx-fine" style={{ fontSize: 12 }}><Consent template={t.continueAgree} t={t} /></p>}
    </div>
  );
}

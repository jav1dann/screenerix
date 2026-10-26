'use client';

/**
 * "Continue with Google": a plain link to the OAuth start route (full-page navigation, so it
 * works from the /login page and the landing modal alike). After the click it shows a
 * redirecting state; coming back with the browser's Back button resets it (bfcache).
 */
import { useEffect, useState } from 'react';

/** Google's standard multicolor "G" mark. */
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

export default function GoogleButton({ next = '/terminal', label = 'Continue with Google', redirectingLabel = 'Redirecting to Google…', disabled = false }: {
  next?: string;
  label?: string;
  redirectingLabel?: string;
  /** Not clickable yet (e.g. the Terms aren't accepted on the Register tab). */
  disabled?: boolean;
}) {
  const [redirecting, setRedirecting] = useState(false);
  // Back from Google restores this page from the bfcache with the old state: reset it.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setRedirecting(false); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    <a
      href={`/api/auth/google?next=${encodeURIComponent(next)}`}
      className="lx-btn lx-btn-google"
      data-google-signin
      aria-busy={redirecting}
      aria-disabled={redirecting || disabled || undefined}
      onClick={(e) => {
        if (redirecting || disabled) { e.preventDefault(); return; }
        setRedirecting(true);
      }}
    >
      {redirecting ? (
        <span aria-hidden="true" className="lx-spin" />
      ) : (
        <GoogleIcon />
      )}
      <span>{redirecting ? redirectingLabel : label}</span>
    </a>
  );
}

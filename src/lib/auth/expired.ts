/**
 * Browser side: an API answered 401 (session expired or revoked while the terminal was
 * open) → go to the login page, coming back here afterwards. Runs once per page.
 *
 * The session is re-checked first: changing the password re-issues this device's cookie in
 * the action's response, and a request sent a moment before still carried the old one.
 */
let leaving = false;
let checking = false;

const RECHECK_MS = 1_500;

export function sessionExpired(): void {
  if (leaving || checking || typeof window === 'undefined') return;
  checking = true;
  setTimeout(() => {
    fetch('/api/scan/status', { cache: 'no-store' })
      .then((r) => r.status === 401)
      .catch(() => false)
      .then((expired) => {
        checking = false;
        if (!expired || leaving) return;
        leaving = true;
        const back = `${window.location.pathname}${window.location.search}`;
        // A full page load on purpose: called outside React, and it tears down every live stream.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/login?next=${encodeURIComponent(back)}`);
      });
  }, RECHECK_MS);
}

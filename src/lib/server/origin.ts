/**
 * The app's public origin: `AUTH_URL` when set (production, behind a proxy), else this
 * request's origin. Builds the URLs handed to third parties — the Google redirect URI and the
 * payment webhook. Server-only.
 */
export function appOrigin(requestOrigin: string): string {
  const configured = process.env.AUTH_URL?.trim().replace(/\/+$/, '');
  if (!configured && process.env.NODE_ENV === 'production') {
    console.error('[app] AUTH_URL is not set — Google redirects and payment webhooks follow the request host; set AUTH_URL to your public origin');
  }
  return configured || requestOrigin;
}

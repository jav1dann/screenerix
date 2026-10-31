/**
 * Server start-up hook (runs once per Next.js server instance).
 * Seeds the admin account, then starts the background scan engine on the Node.js runtime, so the screener and
 * densities caches are warm before — and regardless of — any visitor.
 * Set `SCANNER=off` to disable it (e.g. for a second instance that only serves pages).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Not while `next build` prerenders pages.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // The admin account from ADMIN_EMAIL / ADMIN_PASSWORD (never generated or logged).
  const { ensureAdmin } = await import('@/lib/auth/users');
  await ensureAdmin();
  // Per-IP limits on sign-ins / sign-ups need to know the visitor's address, which only a
  // trusted reverse proxy can tell us.
  const { proxyTrust } = await import('@/lib/server/clientIp');
  if (process.env.NODE_ENV === 'production' && proxyTrust().kind === 'none') {
    console.warn('[security] TRUST_PROXY is not set — sign-in / sign-up limits count per email only, not per IP. Behind nginx / a load balancer set TRUST_PROXY=1 (Cloudflare: TRUST_PROXY=cloudflare)');
  }
  // Telegram bot (account linking, alert delivery): only with TELEGRAM_BOT_TOKEN.
  const { startTelegramBot } = await import('@/lib/telegram/bot');
  startTelegramBot();
  if (process.env.SCANNER === 'off') return;
  const { startEngine } = await import('@/lib/server/scan/engine');
  // Don't hold up server start: the engine restores the cache and starts its loops in the background.
  void startEngine();
}

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
  // The admin account (ADMIN_EMAIL / ADMIN_PASSWORD, or a generated one printed here).
  const { ensureAdmin } = await import('@/lib/auth/users');
  await ensureAdmin();
  // Telegram bot (account linking, alert delivery): only with TELEGRAM_BOT_TOKEN.
  const { startTelegramBot } = await import('@/lib/telegram/bot');
  startTelegramBot();
  if (process.env.SCANNER === 'off') return;
  const { startEngine } = await import('@/lib/server/scan/engine');
  // Don't hold up server start: the engine restores the cache and starts its loops in the background.
  void startEngine();
}

#!/usr/bin/env node
/**
 * `npm run test:alerts` — end-to-end test of the server-side alert pipeline (scripts/alerts-harness.ts).
 *
 * Sets up an isolated world, then runs the harness with tsx (so `@/…` imports resolve):
 *   - a temporary data dir (never `.data/`), deleted afterwards
 *   - a mock Telegram Bot API (getMe / getUpdates / sendMessage) on a free local port
 *   - a throwaway self-signed TLS cert for the local push service (web-push only speaks HTTPS);
 *     trusted through NODE_EXTRA_CA_CERTS — TLS verification stays on
 *   - fresh VAPID keys and a dummy bot token: `.env.local` and real services are never used
 * Needs `openssl` on PATH (for the cert).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sx-alerts-test-'));

/** Mock Telegram Bot API; `GET /__sent` lists what the bot sent. */
function startMockTelegram() {
  const sent = [];
  const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__sent') return json(res, sent);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const method = url.pathname.split('/').pop();
      if (method === 'getMe') return json(res, { ok: true, result: { id: 1, is_bot: true, username: 'sx_test_bot' } });
      if (method === 'sendMessage') { sent.push(JSON.parse(body || '{}')); return json(res, { ok: true, result: { message_id: sent.length } }); }
      if (method === 'getUpdates') return setTimeout(() => json(res, { ok: true, result: [] }), 1_000);
      json(res, { ok: false, description: 'unknown method' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let code = 1;
const telegram = await startMockTelegram();
try {
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'push-key.pem'), '-out', join(dir, 'push-cert.pem'), '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
  } catch {
    throw new Error('openssl is required (it makes the local push service’s TLS certificate)');
  }
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    SX_DATA_DIR: join(dir, 'data'),
    SX_TEST_DIR: dir,
    TELEGRAM_BOT_TOKEN: '123:test',
    TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@screenerix.local',
    NODE_EXTRA_CA_CERTS: join(dir, 'push-cert.pem'),
  };
  const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  code = await new Promise((resolve) => {
    const child = spawn(tsx, ['--tsconfig', join(root, 'tsconfig.json'), join(root, 'scripts', 'alerts-harness.ts')], { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(`test:alerts: ${e.message}`);
} finally {
  telegram.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);

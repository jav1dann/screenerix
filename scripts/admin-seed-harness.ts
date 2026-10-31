/**
 * Runs `ensureAdmin()` once (it seeds once per process) against `SX_DATA_DIR` and prints the
 * admin accounts as JSON on the last line. Started by test-security.ts, one process per scenario.
 */
(async () => {
  const users = await import('@/lib/auth/users');
  await users.ensureAdmin();
  const { readFileSync, existsSync } = await import('node:fs');
  const file = `${process.env.SX_DATA_DIR}/users.json`;
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { users: Array<{ email: string; role: string; sessionVersion: number }> }).users : [];
  const pw = process.env.CHECK_PASSWORD;
  const admins = await Promise.all(all.filter((u) => u.role === 'admin').map(async (u) => ({
    email: u.email, sessionVersion: u.sessionVersion,
    ...(pw ? { passwordMatches: await users.verifyPassword(users.findByEmail(u.email)!, pw) } : {}),
  })));
  console.log(JSON.stringify({ admins }));
})();

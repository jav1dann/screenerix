'use client';

import { useRouter } from 'next/navigation';
import type { SessionUser } from '@/lib/auth/access';
import Terminal from './Terminal';

/** Client shell of /terminal: "Exit to website" goes back to the landing page. */
export default function TerminalApp({ user }: { user: SessionUser }) {
  const router = useRouter();
  return <Terminal user={user} onExit={() => router.push('/')} />;
}

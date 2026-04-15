import { auth } from '@/lib/auth';
import { getDb } from '@mxwatch/db';
import { headers } from 'next/headers';

export async function createContext() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  return {
    db: getDb(),
    user: session?.user ?? null,
    session: session?.session ?? null,
    // Threaded into ctx so activity-log / API-token / IP-allowlist code
    // can record the client without re-reading headers in each handler.
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent') ?? null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

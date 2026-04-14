import { auth } from '@/lib/auth';
import { getDb } from '@mxwatch/db';
import { headers } from 'next/headers';

export async function createContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  return {
    db: getDb(),
    user: session?.user ?? null,
    session: session?.session ?? null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

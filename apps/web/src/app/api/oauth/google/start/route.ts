import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { googleEnabled } from '@/lib/google-config';
import { buildAuthUrl, signState } from '@/lib/google-oauth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.json({ error: 'Google integration not configured' }, { status: 503 });
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.url));
  const state = signState(session.user.id);
  return NextResponse.redirect(buildAuthUrl(state));
}

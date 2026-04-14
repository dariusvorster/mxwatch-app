import { NextResponse } from 'next/server';
import { googleEnabled } from '@/lib/google-config';
import { exchangeCodeForTokens, saveConnection, verifyState } from '@/lib/google-oauth';

export const runtime = 'nodejs';

function err(req: Request, message: string) {
  const url = new URL('/settings/google', req.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  if (!googleEnabled()) return err(req, 'not-configured');
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const googleError = url.searchParams.get('error');
  if (googleError) return err(req, googleError);
  if (!code || !state) return err(req, 'missing-params');

  const verified = verifyState(state);
  if (!verified) return err(req, 'bad-state');

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(verified.userId, tokens);
  } catch (e: any) {
    console.error('[oauth/google/callback] exchange failed', e);
    return err(req, 'exchange-failed');
  }

  return NextResponse.redirect(new URL('/settings/google?connected=1', req.url));
}

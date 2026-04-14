export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/postmaster.readonly';

export function googleEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function googleClientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error('GOOGLE_CLIENT_ID not set');
  return v;
}

export function googleClientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error('GOOGLE_CLIENT_SECRET not set');
  return v;
}

export function googleRedirectUrl(): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URL) return process.env.GOOGLE_OAUTH_REDIRECT_URL;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/oauth/google/callback`;
}

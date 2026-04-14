import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, schema } from '@mxwatch/db';

const baseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000';

/**
 * Origins we trust for auth requests. For self-hosted deployments the admin
 * may expose MxWatch via LAN IP, Tailscale, a reverse-proxy hostname, a
 * public domain, etc — all at once. Rather than ask them to list each, we
 * trust whichever origin *matches the Host header of the request itself*.
 *
 * This still blocks cross-site forgery: evil.com's Origin header won't match
 * the Host the request arrived at, so it's rejected.
 *
 * Admins who want a stricter allowlist can set MXWATCH_TRUSTED_ORIGINS (comma
 * -separated) — when set, we only trust those + baseURL.
 */
const explicitOrigins = (process.env.MXWATCH_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function trustedOrigins(request: Request): string[] {
  const host = request.headers.get('host');
  const fwdProto = request.headers.get('x-forwarded-proto');
  const proto = fwdProto?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '');
  const hostOrigin = host ? `${proto}://${host}` : null;
  const list = [baseURL, ...explicitOrigins, ...(hostOrigin ? [hostOrigin] : [])];
  if (process.env.MXWATCH_AUTH_DEBUG === '1') {
    console.log('[auth] trustedOrigins', {
      origin: request.headers.get('origin'),
      host,
      fwdProto,
      returning: list,
    });
  }
  return list;
}

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  secret: process.env.MXWATCH_SECRET ?? 'dev-secret-change-me-please-32chars',
  baseURL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
});

export type Auth = typeof auth;

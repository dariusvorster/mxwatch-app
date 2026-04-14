import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, schema } from '@mxwatch/db';

const baseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000';

// Comma-separated list of additional origins the server should accept auth
// requests from. Useful when the same deployment is reached via multiple
// hostnames (IP, LAN name, reverse-proxy, Tailscale MagicDNS, etc).
const trustedOrigins = [
  baseURL,
  ...(process.env.MXWATCH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

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

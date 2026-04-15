'use client';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

// Always same-origin. Avoids baked-in NEXT_PUBLIC_APP_URL mismatches when the
// deployment is reached via IP / port / reverse-proxy hostname.
const baseURL = typeof window !== 'undefined' ? window.location.origin : undefined;

export const authClient = createAuthClient({
  baseURL,
  plugins: [twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession, twoFactor } = authClient;

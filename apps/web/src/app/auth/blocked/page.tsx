'use client';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';

export default function BlockedPage() {
  const { data: session } = useSession();
  // ipAllowlistGet bypasses the allowlist check (security.* paths skip it)
  // so we can still tell the user what IP they're on.
  const allowlist = trpc.security.ipAllowlistGet.useQuery(undefined, { enabled: !!session });

  return (
    <main style={{
      maxWidth: 480, margin: '80px auto', padding: 24,
      background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      fontFamily: 'var(--sans)',
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--red)', marginBottom: 12 }}>
        Access denied
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5 }}>
        Your IP address is not in the allowlist for this account.
      </p>
      {allowlist.data?.currentIp && (
        <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginTop: 12 }}>
          Current IP: <span style={{ color: 'var(--text)' }}>{allowlist.data.currentIp}</span>
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 16 }}>
        If this is a mistake, sign in from an allowed network and adjust the list at{' '}
        <Link href="/settings/security" style={{ color: 'var(--blue)' }}>Settings → Security</Link>.
      </p>
    </main>
  );
}

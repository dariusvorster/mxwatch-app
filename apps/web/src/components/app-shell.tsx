'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { useSession } from '@/lib/auth-client';

const AUTH_ROUTES = ['/login', '/signup', '/onboarding', '/setup/2fa', '/auth'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const { data: session } = useSession();
  const bare = AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  // Cloud deployments enforce 2FA — redirect signed-in users without TOTP
  // to the setup page (except when they're already on it or on an auth
  // route). Self-hosted opts out via the NEXT_PUBLIC_MXWATCH_CLOUD flag
  // being absent.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MXWATCH_CLOUD !== '1') return;
    if (!session?.user) return;
    if (bare) return;
    if ((session.user as any).twoFactorEnabled) return;
    router.replace('/setup/2fa');
  }, [session, bare, router]);

  if (bare) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        {children}
      </main>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        <main style={{ flex: 1, padding: '24px 28px' }}>{children}</main>
      </div>
    </div>
  );
}

'use client';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

const AUTH_ROUTES = ['/login', '/signup', '/onboarding'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const bare = AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

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

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconPlus, IconDot } from '@/components/icons';

// Path segments that exist only as URL groupings — there's no top-level route
// page for them. Breadcrumbs render these as plain text so Next.js doesn't
// prefetch a 404.
const SYNTHETIC_PARENTS = new Set(['/domains', '/tools', '/integrations']);

function buildBreadcrumb(pathname: string): Array<{ label: string; href?: string }> {
  if (pathname === '/' || pathname === '') return [{ label: 'Dashboard' }];
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; href?: string }> = [{ label: 'Dashboard', href: '/' }];
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    acc += `/${p}`;
    const isLast = i === parts.length - 1;
    // Friendly labels for known segments
    const label =
      p === 'settings' ? 'Settings' :
      p === 'domains' ? 'Domains' :
      p === 'smtp' ? 'SMTP ingest' :
      p === 'alerts' ? 'Alert channels' :
      p === 'api' ? 'API tokens' :
      p === 'google' ? 'Postmaster Tools' :
      p === 'warmup' ? 'IP warm-up' :
      p === 'onboarding' ? 'Onboarding' :
      p;
    const href = isLast || SYNTHETIC_PARENTS.has(acc) ? undefined : acc;
    crumbs.push({ label, href });
  }
  return crumbs;
}

export function Topbar() {
  const pathname = usePathname() ?? '/';
  const crumbs = buildBreadcrumb(pathname);

  return (
    <div
      style={{
        height: 52,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surf)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--sans)', fontSize: 13 }}>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const color = isLast ? 'var(--text)' : 'var(--text3)';
          const weight = isLast ? 600 : 400;
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {c.href ? (
                <Link href={c.href} style={{ color, fontWeight: weight }}>{c.label}</Link>
              ) : (
                <span style={{ color, fontWeight: weight }}>{c.label}</span>
              )}
              {!isLast && <span style={{ color: 'var(--text3)' }}>/</span>}
            </span>
          );
        })}
      </div>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)',
          }}
        >
          <IconDot size={8} style={{ color: 'var(--green)' }} />
          synced just now
        </div>
        <Link
          href="/onboarding"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
            padding: '7px 12px', borderRadius: 7,
            background: 'var(--blue)', color: '#fff',
            border: '1px solid var(--blue)',
          }}
        >
          <IconPlus size={12} />
          Add domain
        </Link>
      </div>
    </div>
  );
}

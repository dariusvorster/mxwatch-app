'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  IconPulse, IconDashboard, IconActivity, IconGlobe, IconShield, IconMail,
  IconCert, IconBell, IconHistory, IconSettings,
} from '@/components/icons';
import type { ComponentType, SVGProps } from 'react';

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface NavItem {
  label: string;
  href?: string;       // undefined = disabled / coming-soon
  icon: IconComp;
  badge?: { text: string; variant: 'neutral' | 'green' | 'red' };
  matches?: RegExp;    // active when pathname matches
}

function Avatar({ email, image, size = 44 }: { email?: string | null; image?: string | null; size?: number }) {
  if (image) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: size / 2,
          background: `center/cover url(${image})`,
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}
        aria-hidden
      />
    );
  }
  const letter = email?.[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{
        width: size, height: size,
        background: 'var(--blue-dim)',
        color: 'var(--blue)',
        fontFamily: 'var(--mono)',
        fontWeight: 600,
        fontSize: Math.round(size * 0.42),
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--text3)',
          textTransform: 'uppercase',
          padding: '0 14px',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="flex flex-col gap-1 px-2">{children}</div>
    </div>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 10px',
    borderRadius: 8,
    fontFamily: 'var(--sans)',
    fontSize: 13,
    fontWeight: 500,
    transition: 'background 120ms ease, color 120ms ease',
  } as const;

  const activeStyle = {
    background: 'var(--blue-dim)',
    color: 'var(--blue)',
    border: '1px solid var(--blue-border)',
  };
  const idleStyle = {
    color: 'var(--text2)',
    border: '1px solid transparent',
  };
  const disabledStyle = {
    color: 'var(--text3)',
    border: '1px solid transparent',
    cursor: 'not-allowed',
  };

  const style = !item.href ? { ...base, ...disabledStyle } : active ? { ...base, ...activeStyle } : { ...base, ...idleStyle };

  const content = (
    <>
      <Icon size={14} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 6,
            background:
              item.badge.variant === 'green' ? 'var(--green-dim)' :
              item.badge.variant === 'red' ? 'var(--red-dim)' : 'var(--bg2)',
            color:
              item.badge.variant === 'green' ? 'var(--green)' :
              item.badge.variant === 'red' ? 'var(--red)' : 'var(--text2)',
            border:
              item.badge.variant === 'green' ? '1px solid var(--green-border)' :
              item.badge.variant === 'red' ? '1px solid var(--red-border)' : '1px solid var(--border)',
          }}
        >
          {item.badge.text}
        </span>
      )}
    </>
  );

  if (!item.href) {
    return (
      <div style={style} title="Coming soon">
        {content}
      </div>
    );
  }
  return (
    <Link
      href={item.href}
      style={style}
      className={active ? '' : 'hover:[background:var(--bg2)]'}
    >
      {content}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const activeAlerts = trpc.alerts.history.useQuery({ onlyActive: true }, { enabled: !!session });
  const activeDelists = trpc.delist.active.useQuery(undefined, { enabled: !!session });

  const domainCount = domains.data?.length ?? 0;
  const activeAlertCount = activeAlerts.data?.length ?? 0;
  const activeDelistCount = activeDelists.data?.length ?? 0;
  // Badge: count of active delist requests; fall back to "!" if a blacklist
  // alert fired but no delist request has been opened yet.
  const blacklistListed = (activeAlerts.data ?? []).some((a) => a.type === 'blacklist_listed');
  const blacklistBadge =
    activeDelistCount > 0
      ? { text: String(activeDelistCount), variant: 'red' as const }
      : blacklistListed
      ? { text: '!', variant: 'red' as const }
      : undefined;

  const nav: Array<{ label: string; items: NavItem[] }> = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', href: '/', icon: IconDashboard, matches: /^\/$/ },
        { label: 'Activity', href: '/activity', icon: IconActivity, matches: /^\/activity/ },
      ],
    },
    {
      label: 'Monitoring',
      items: [
        {
          label: 'Domains', href: '/', icon: IconGlobe,
          badge: domainCount > 0 ? { text: String(domainCount), variant: 'neutral' } : undefined,
          matches: /^\/domains(\/|$)/,
        },
        {
          label: 'Blacklists', href: '/blacklists', icon: IconShield,
          badge: blacklistBadge,
          matches: /^\/blacklists/,
        },
        {
          label: 'DMARC reports', href: '/reports', icon: IconMail,
          badge: domainCount > 0 ? { text: 'on', variant: 'green' } : undefined,
          matches: /^\/reports/,
        },
        { label: 'Certificates', href: '/certificates', icon: IconCert, matches: /^\/certificates/ },
        { label: 'Watched domains', href: '/watched', icon: IconActivity, matches: /^\/watched/ },
        { label: 'Mail servers', href: '/servers', icon: IconPulse, matches: /^\/servers/ },
        { label: 'Delivery rates', href: '/delivery-rates', icon: IconActivity, matches: /^\/delivery-rates/ },
        { label: 'Bounces', href: '/bounces', icon: IconMail, matches: /^\/bounces/ },
        { label: 'IP reputation', href: '/ip-reputation', icon: IconShield, matches: /^\/ip-reputation/ },
      ],
    },
    {
      label: 'Tools',
      items: [
        {
          label: 'Deliverability test', href: '/tools/deliverability', icon: IconMail,
          matches: /^\/tools\/deliverability/,
        },
        {
          label: 'Record builder', href: '/tools/record-builder', icon: IconSettings,
          matches: /^\/tools\/record-builder/,
        },
        {
          label: 'Propagation checker', href: '/tools/propagation', icon: IconActivity,
          matches: /^\/tools\/propagation/,
        },
      ],
    },
    {
      label: 'Integrations',
      items: [
        {
          label: 'Stalwart', href: '/integrations/stalwart', icon: IconPulse,
          matches: /^\/integrations\/stalwart/,
        },
      ],
    },
    {
      label: 'Alerts',
      items: [
        {
          label: 'Alert rules', href: '/settings/alerts', icon: IconBell,
          badge: activeAlertCount > 0 ? { text: String(activeAlertCount), variant: 'red' } : undefined,
          matches: /^\/settings\/alerts/,
        },
        { label: 'Alert history', href: '/alerts/history', icon: IconHistory, matches: /^\/alerts\/history/ },
        { label: 'Activity feed', href: '/history', icon: IconHistory, matches: /^\/history/ },
        { label: 'Logs', href: '/logs', icon: IconActivity, matches: /^\/logs/ },
      ],
    },
  ];

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--surf)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: '16px 16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconPulse size={20} style={{ color: 'var(--blue-mid)' }} />
        <div
          style={{
            fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'baseline', gap: 2,
          }}
        >
          <span style={{ color: 'var(--text)' }}>mx</span>
          <span style={{ color: 'var(--blue-mid)' }}>watch</span>
        </div>
        <span
          style={{
            fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 600,
            padding: '2px 5px', borderRadius: 4,
            background: 'var(--blue-dim)', color: 'var(--blue)',
            border: '1px solid var(--blue-border)',
            letterSpacing: '0.04em',
          }}
        >
          v4
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {nav.map((s) => (
          <Section key={s.label} label={s.label}>
            {s.items.map((item) => (
              <NavRow
                key={item.label}
                item={item}
                active={!!item.href && !!item.matches?.test(pathname ?? '')}
              />
            ))}
          </Section>
        ))}
      </nav>

      {/* User footer — avatar on the left, three action buttons on top,
          name + deployment badge underneath. */}
      <div
        style={{
          padding: 14,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--surf)',
        }}
      >
        {session ? (
          <>
            <Link href="/settings/profile" aria-label="Profile" title="Profile">
              <Avatar email={session.user?.email} image={(session.user as any)?.image ?? null} size={44} />
            </Link>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <Link
                  href="/settings"
                  aria-label="Settings"
                  title="Settings"
                  style={iconButtonStyle}
                >
                  <IconSettings size={14} />
                </Link>
                <ThemeToggle />
                <LogoutButton />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500,
                    color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {session.user?.name ?? session.user?.email}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                  self-hosted · v4
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text3)' }}>Not signed in</div>
        )}
      </div>
    </aside>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 6, background: 'var(--bg2)', color: 'var(--text2)',
  border: '1px solid var(--border)',
};

function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      title="Log out"
      aria-label="Log out"
      onClick={async () => {
        const { signOut } = await import('@/lib/auth-client');
        await signOut();
        router.push('/login');
      }}
      style={{
        width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, background: 'var(--bg2)', color: 'var(--text2)',
        border: '1px solid var(--border)', cursor: 'pointer',
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    </button>
  );
}

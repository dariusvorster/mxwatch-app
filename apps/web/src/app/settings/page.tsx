'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/lib/trpc';
import {
  IconBell, IconMail, IconCert, IconActivity, IconSettings, IconGlobe, IconPulse, IconShield,
} from '@/components/icons';
import type { ComponentType, SVGProps } from 'react';

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface Tile {
  href: string;
  title: string;
  description: string;
  icon: IconComp;
}

const TILES: Tile[] = [
  { href: '/onboarding', title: 'Setup wizard', description: 'Re-run the guided setup: domain, architecture, integration, alerts.', icon: IconPulse },
  { href: '/settings/security', title: 'Security', description: '2FA, sessions, API tokens, IP allowlist, password, activity log.', icon: IconShield },
  { href: '/settings/logs', title: 'Logging', description: 'Log level, retention, export, clear.', icon: IconActivity },
  { href: '/settings/alerts', title: 'Alert channels', description: 'Email, Slack, ntfy, and webhook destinations for alerts.', icon: IconBell },
  { href: '/settings/smtp', title: 'SMTP ingest', description: 'How DMARC aggregate reports reach MxWatch.', icon: IconMail },
  { href: '/settings/google', title: 'Google Postmaster Tools', description: 'Gmail-side spam rate and IP reputation for your domains.', icon: IconCert },
  { href: '/settings/warmup', title: 'IP warm-up', description: 'Ramp send volume on a new sending IP.', icon: IconActivity },
  { href: '/settings/api', title: 'API tokens', description: 'Read-only API access for dashboards and scripts.', icon: IconSettings },
];

export default function SettingsIndex() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const billing = trpc.billing.status.useQuery(undefined, { enabled: !!session });
  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);
  if (isPending || !session) return <main>Loading…</main>;

  const tiles: Tile[] = [...TILES];
  if (billing.data?.available) {
    tiles.unshift({ href: '/settings/billing', title: 'Billing', description: 'Manage your MxWatch Cloud subscription.', icon: IconPulse });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Settings
        </h1>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
          Signed in as <span style={{ fontFamily: 'var(--mono)' }}>{session.user.email}</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {tiles.map((t) => <TileCard key={t.href} tile={t} />)}
      </div>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      style={{
        display: 'flex',
        gap: 12,
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '16px 18px',
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
    >
      <div
        style={{
          width: 36, height: 36, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8,
          background: 'var(--blue-dim)',
          color: 'var(--blue)',
          border: '1px solid var(--blue-border)',
        }}
      >
        <Icon size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)',
          }}
        >
          {tile.title}
        </div>
        <div
          style={{
            fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.4,
          }}
        >
          {tile.description}
        </div>
      </div>
    </Link>
  );
}

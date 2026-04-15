'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';

function toneFor(status: string | null | undefined): 'healthy' | 'warning' | 'critical' | 'neutral' {
  if (status === 'ok') return 'healthy';
  if (status === 'error') return 'critical';
  return 'neutral';
}

export default function ServersPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const list = trpc.serverIntegrations.list.useQuery(undefined, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            Mail servers
          </h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {list.data?.length ?? 0} integration{(list.data?.length ?? 0) === 1 ? '' : 's'}
          </div>
        </div>
        <Link href="/servers/new">
          <Button>+ Add server</Button>
        </Link>
      </div>

      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent style={{ padding: 22, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No mail servers connected yet.{' '}
            <Link href="/servers/new" style={{ color: 'var(--blue)', fontWeight: 500 }}>Connect your first</Link>.
          </CardContent>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {(list.data ?? []).map((s) => (
          <Link key={s.id} href={`/servers/${s.id}`} style={{ textDecoration: 'none' }}>
            <Card style={{ transition: 'border-color 120ms ease' }}>
              <CardContent style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {s.name}
                  </div>
                  <StatusBadge tone={toneFor(s.status)}>{s.status ?? 'unknown'}</StatusBadge>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                  {s.serverType} · {s.architecture}
                </div>
                {s.baseUrl && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', wordBreak: 'break-all' }}>
                    {s.baseUrl}
                  </div>
                )}
                {s.lastError && (
                  <div style={{ fontSize: 11, color: 'var(--red)' }}>{s.lastError}</div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

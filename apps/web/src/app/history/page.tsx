'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

function severityTone(sev: string | undefined): 'critical' | 'warning' | 'info' | 'healthy' | 'neutral' {
  if (sev === 'critical' || sev === 'high') return 'critical';
  if (sev === 'medium') return 'warning';
  if (sev === 'info') return 'info';
  return 'neutral';
}

export default function HistoryPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const feed = trpc.activity.feed.useQuery({ limit: 300 }, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  return (
    <div className="space-y-5" style={{ maxWidth: 900 }}>
      <PageHeader title="History" subtitle="Long-tail view of every check, report, and alert across your domains." />
      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {feed.isLoading ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
        ) : !feed.data || feed.data.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>Nothing yet.</div>
        ) : (
          feed.data.map((ev, i) => (
            <div
              key={ev.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              }}
            >
              <StatusBadge tone={severityTone(ev.severity)}>{ev.severity ?? 'info'}</StatusBadge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                  {ev.title}
                </div>
                {ev.subtitle && (
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                    {ev.subtitle}
                  </div>
                )}
              </div>
              <Link href={`/domains/${ev.domainId}`} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--blue)' }}>
                {ev.domainName}
              </Link>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                {relativeTime(ev.timestamp)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

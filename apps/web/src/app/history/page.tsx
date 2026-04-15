'use client';
import { useEffect, useMemo, useState } from 'react';
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

type FilterKey = 'all' | 'alerts' | 'dns' | 'blacklist' | 'dmarc';

const FILTER_TYPES: Record<FilterKey, string[]> = {
  all: [],
  alerts: ['alert_fired', 'alert_resolved'],
  dns: ['dns_snapshot'],
  blacklist: ['rbl_check'],
  dmarc: ['dmarc_report'],
};

export default function HistoryPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const feed = trpc.activity.feed.useQuery({ limit: 300 }, { enabled: !!session });
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  const rows = useMemo(() => {
    const list = feed.data ?? [];
    if (filter === 'all') return list;
    const allowed = new Set(FILTER_TYPES[filter]);
    return list.filter((ev: any) => allowed.has(ev.type));
  }, [feed.data, filter]);

  if (isPending || !session) return <div>Loading…</div>;

  return (
    <div className="space-y-5" style={{ maxWidth: 900 }}>
      <PageHeader title="History" subtitle="Long-tail view of every check, report, and alert across your domains." />

      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 3, borderRadius: 999, width: 'fit-content' }}>
        {(['all', 'alerts', 'dns', 'blacklist', 'dmarc'] as FilterKey[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500,
              padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: filter === f ? 'var(--surf)' : 'transparent',
              color: filter === f ? 'var(--text)' : 'var(--text3)',
              boxShadow: filter === f ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

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
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>
            {filter === 'all' ? 'Nothing yet.' : 'No events match this filter.'}
          </div>
        ) : (
          rows.map((ev, i) => (
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

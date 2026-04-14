'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

type EventType = 'alert_fired' | 'alert_resolved' | 'rbl_check' | 'dns_snapshot' | 'dmarc_report';

const FILTERS: Array<{ value: EventType; label: string }> = [
  { value: 'alert_fired', label: 'Alerts fired' },
  { value: 'alert_resolved', label: 'Alerts resolved' },
  { value: 'rbl_check', label: 'RBL checks' },
  { value: 'dns_snapshot', label: 'DNS checks' },
  { value: 'dmarc_report', label: 'DMARC reports' },
];

function severityTone(sev: string | undefined): 'critical' | 'warning' | 'info' | 'healthy' | 'neutral' {
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'critical';
  if (sev === 'medium') return 'warning';
  if (sev === 'info') return 'info';
  return 'neutral';
}

export default function ActivityPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [types, setTypes] = useState<EventType[] | undefined>(undefined);

  const feed = trpc.activity.feed.useQuery(
    { limit: 200, types },
    { enabled: !!session },
  );

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  function toggleFilter(t: EventType) {
    setTypes((curr) => {
      if (!curr) return [t];
      const has = curr.includes(t);
      const next = has ? curr.filter((x) => x !== t) : [...curr, t];
      return next.length === 0 ? undefined : next;
    });
  }

  return (
    <div className="space-y-5" style={{ maxWidth: 900 }}>
      <PageHeader title="Activity" subtitle="Unified feed of events across every domain you monitor." />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const active = !types || types.includes(f.value);
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => toggleFilter(f.value)}
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 11,
                fontWeight: 500,
                padding: '5px 10px',
                borderRadius: 6,
                background: active ? 'var(--blue-dim)' : 'var(--surf)',
                color: active ? 'var(--blue)' : 'var(--text3)',
                border: `1px solid ${active ? 'var(--blue-border)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          );
        })}
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
        ) : !feed.data || feed.data.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>
            No events yet. Run a check on a domain or wait for the scheduler.
          </div>
        ) : (
          feed.data.map((ev, i) => (
            <div
              key={ev.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              }}
            >
              <StatusBadge tone={severityTone(ev.severity)}>{ev.severity ?? 'info'}</StatusBadge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                  {ev.title}
                </div>
                {ev.subtitle && (
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {ev.subtitle}
                  </div>
                )}
              </div>
              <Link
                href={`/domains/${ev.domainId}`}
                style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--blue)', whiteSpace: 'nowrap' }}
              >
                {ev.domainName}
              </Link>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                {relativeTime(ev.timestamp)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { humanizeAlertType, relativeTime, severityFor } from '@/lib/alert-display';

function severityTone(sev: string): 'critical' | 'warning' | 'info' | 'healthy' | 'neutral' {
  if (sev === 'critical' || sev === 'high') return 'critical';
  if (sev === 'medium') return 'warning';
  if (sev === 'low') return 'info';
  return 'neutral';
}

export default function AlertsHistoryPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all');
  const utils = trpc.useUtils();
  const q = trpc.alerts.history.useQuery(
    { onlyActive: filter === 'active' },
    { enabled: !!session },
  );
  const resolve = trpc.alerts.resolve.useMutation({
    onSuccess: () => utils.alerts.history.invalidate(),
  });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const rows = (q.data ?? []).filter((r) =>
    filter === 'resolved' ? r.resolvedAt != null : true,
  );

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Alert history"
        subtitle="Every alert fired across your domains, with quick resolve actions."
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 3, borderRadius: 999, width: 'fit-content' }}>
        {(['all', 'active', 'resolved'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 12,
              fontWeight: 500,
              padding: '5px 14px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: filter === f ? 'var(--surf)' : 'transparent',
              color: filter === f ? 'var(--text)' : 'var(--text3)',
              boxShadow: filter === f ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
        <button
          type="button"
          onClick={() => exportCsv(rows)}
          disabled={rows.length === 0}
          style={{
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
            padding: '6px 12px', borderRadius: 8,
            background: 'transparent', color: 'var(--text2)',
            border: '1px solid var(--border2)',
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            opacity: rows.length === 0 ? 0.5 : 1,
          }}
        >
          Download CSV
        </button>
      </div>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {q.isLoading ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>No alerts match this filter.</div>
        ) : (
          rows.map((a, i) => {
            const sev = severityFor(a.type);
            const isActive = a.resolvedAt == null;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 16px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  opacity: isActive ? 1 : 0.7,
                }}
              >
                <StatusBadge tone={severityTone(sev)}>{sev}</StatusBadge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <Link
                      href={`/domains/${a.domainId}`}
                      style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)' }}
                    >
                      {a.domainName}
                    </Link>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{humanizeAlertType(a.type)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                      fired {relativeTime(a.firedAt)}
                      {a.resolvedAt && ` · resolved ${relativeTime(a.resolvedAt)}`}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 3 }}>{a.message}</div>
                </div>
                {isActive ? (
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ id: a.id })}
                    disabled={resolve.isPending}
                    style={resolveBtn}
                  >
                    {resolve.isPending && resolve.variables?.id === a.id ? 'Resolving…' : 'Mark resolved'}
                  </button>
                ) : (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--green)', marginTop: 4 }}>
                    ✓ resolved
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function exportCsv(rows: Array<{
  id: string;
  domainName: string;
  type: string;
  message: string;
  firedAt: Date | string;
  resolvedAt: Date | string | null;
}>) {
  const header = ['id', 'domain', 'type', 'firedAt', 'resolvedAt', 'message'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.id,
      r.domainName,
      r.type,
      new Date(r.firedAt).toISOString(),
      r.resolvedAt ? new Date(r.resolvedAt).toISOString() : '',
      r.message,
    ].map(csvEscape).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mxwatch-alert-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const resolveBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text2)',
  border: '1px solid var(--border2)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

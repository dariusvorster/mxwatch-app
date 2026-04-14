'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SummaryCard } from '@/components/summary-card';

function formatPct(n: number | null) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export default function ReportsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const overview = trpc.activity.reportOverview.useQuery({ days: 30 }, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const rows = overview.data?.rows ?? [];
  const windowDays = overview.data?.windowDays ?? 30;
  const totalReports = rows.reduce((s, r) => s + r.reports, 0);
  const totalMessages = rows.reduce((s, r) => s + r.totalMessages, 0);
  const totalPass = rows.reduce((s, r) => s + r.passCount, 0);
  const totalFail = rows.reduce((s, r) => s + r.failCount, 0);
  const overallPassRate = totalMessages > 0 ? totalPass / totalMessages : null;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader title="DMARC reports" subtitle={`Aggregate aggregate reports across all your domains — last ${windowDays} days.`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <SummaryCard label="Reports" value={totalReports} valueTone="blue" subtext="ingested" />
        <SummaryCard label="Messages" value={totalMessages.toLocaleString()} valueTone="blue" />
        <SummaryCard label="Pass rate" value={formatPct(overallPassRate)} valueTone={overallPassRate != null && overallPassRate >= 0.98 ? 'green' : overallPassRate != null && overallPassRate >= 0.9 ? 'amber' : 'red'} />
        <SummaryCard label="Fail" value={totalFail.toLocaleString()} valueTone={totalFail > 0 ? 'red' : 'green'} />
      </div>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>No domains yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Domain</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Reports</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Messages</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Pass rate</th>
                <th style={headCell}>Status</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Fail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tone = r.reports === 0
                  ? 'neutral'
                  : r.passRate != null && r.passRate >= 0.98
                  ? 'healthy'
                  : r.passRate != null && r.passRate >= 0.9
                  ? 'warning'
                  : 'critical';
                const statusLabel = r.reports === 0 ? 'no reports' : tone === 'healthy' ? 'healthy' : tone === 'warning' ? 'watch' : 'failing';
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={bodyCell}>
                      <Link href={`/domains/${r.id}`} style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                        {r.domain}
                      </Link>
                    </td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right' }}>{r.reports}</td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right' }}>{r.totalMessages.toLocaleString()}</td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right' }}>{formatPct(r.passRate)}</td>
                    <td style={bodyCell}><StatusBadge tone={tone}>{statusLabel}</StatusBadge></td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right', color: r.failCount > 0 ? 'var(--red)' : 'var(--text3)' }}>
                      {r.failCount.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const headCell: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontFamily: 'var(--sans)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};
const bodyCell: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };

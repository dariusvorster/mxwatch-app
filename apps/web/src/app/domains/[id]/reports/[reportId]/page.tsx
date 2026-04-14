'use client';
import { use } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SummaryCard } from '@/components/summary-card';

export default function ReportDetailPage({ params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = use(params);
  const detail = trpc.reports.detail.useQuery({ reportId });

  if (detail.isLoading) return <div>Loading…</div>;
  if (!detail.data) return <div>Report not found.</div>;

  const { report, rows } = detail.data;
  const total = report.totalMessages ?? 0;
  const pass = report.passCount ?? 0;
  const fail = report.failCount ?? 0;
  const passRate = total > 0 ? pass / total : null;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader
        title={`DMARC report — ${report.orgName}`}
        subtitle={
          <>
            Received {new Date(report.receivedAt).toLocaleString()} ·{' '}
            <Link href={`/domains/${id}`} style={{ color: 'var(--blue)' }}>back to domain</Link>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <SummaryCard label="Messages" value={total.toLocaleString()} valueTone="blue" />
        <SummaryCard label="Pass" value={pass.toLocaleString()} valueTone="green" />
        <SummaryCard label="Fail" value={fail.toLocaleString()} valueTone={fail > 0 ? 'red' : 'green'} />
        <SummaryCard
          label="Pass rate"
          value={passRate != null ? `${(passRate * 100).toFixed(1)}%` : '—'}
          valueTone={passRate != null && passRate >= 0.98 ? 'green' : passRate != null && passRate >= 0.9 ? 'amber' : 'red'}
        />
      </div>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>Per-source breakdown</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            report {report.reportId} · range{' '}
            {report.dateRangeBegin ? new Date(report.dateRangeBegin).toISOString().slice(0, 10) : '—'}
            {' → '}
            {report.dateRangeEnd ? new Date(report.dateRangeEnd).toISOString().slice(0, 10) : '—'}
          </div>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>No rows in this report.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Source IP</th>
                <th style={headCell}>Header from</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Count</th>
                <th style={headCell}>Disposition</th>
                <th style={headCell}>SPF</th>
                <th style={headCell}>DKIM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12 }}>{r.sourceIp}</td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>{r.headerFrom ?? '—'}</td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right' }}>{r.count}</td>
                  <td style={bodyCell}>
                    {r.disposition === 'reject' ? <StatusBadge tone="critical">reject</StatusBadge>
                    : r.disposition === 'quarantine' ? <StatusBadge tone="warning">quarantine</StatusBadge>
                    : <StatusBadge tone="neutral">{r.disposition ?? 'none'}</StatusBadge>}
                  </td>
                  <td style={bodyCell}>
                    {r.spfResult === 'pass' ? <StatusBadge tone="healthy">pass</StatusBadge> : <StatusBadge tone="critical">{r.spfResult ?? 'fail'}</StatusBadge>}
                  </td>
                  <td style={bodyCell}>
                    {r.dkimResult === 'pass' ? <StatusBadge tone="healthy">pass</StatusBadge> : <StatusBadge tone="critical">{r.dkimResult ?? 'fail'}</StatusBadge>}
                  </td>
                </tr>
              ))}
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

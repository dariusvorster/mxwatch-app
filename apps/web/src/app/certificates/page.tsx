'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SummaryCard } from '@/components/summary-card';
import { relativeTime } from '@/lib/alert-display';

function daysTone(days: number | null): 'healthy' | 'warning' | 'critical' | 'neutral' {
  if (days == null) return 'neutral';
  if (days < 7) return 'critical';
  if (days < 30) return 'warning';
  return 'healthy';
}

type Row = {
  domainId: string;
  domain: string;
  hostname: string;
  daysUntilExpiry: number | null;
  validTo: Date | null;
  issuer: string | null;
  authorized: boolean | null;
  error: string | null;
  checkedAt: Date;
};

export default function CertificatesPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });

  const certQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestCerts({ domainId: d.id }, { enabled: !!session })),
  );

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const rows: Row[] = [];
  (domains.data ?? []).forEach((d, i) => {
    const certs = certQueries[i]?.data ?? [];
    for (const c of certs) {
      rows.push({
        domainId: d.id,
        domain: d.domain,
        hostname: c.hostname,
        daysUntilExpiry: c.daysUntilExpiry,
        validTo: c.validTo ? new Date(c.validTo) : null,
        issuer: c.issuer,
        authorized: c.authorized,
        error: c.error,
        checkedAt: new Date(c.checkedAt),
      });
    }
  });
  rows.sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999));

  const nearExpiry = rows.filter((r) => r.daysUntilExpiry != null && r.daysUntilExpiry < 30).length;
  const unauthorized = rows.filter((r) => r.authorized === false).length;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Certificates"
        subtitle="TLS certificates for your mail and web hostnames, sorted by days until expiry."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <SummaryCard label="Certificates" value={rows.length} valueTone="blue" />
        <SummaryCard label="Near expiry" value={nearExpiry} valueTone={nearExpiry > 0 ? 'red' : 'green'} subtext="< 30 days" />
        <SummaryCard label="Untrusted" value={unauthorized} valueTone={unauthorized > 0 ? 'red' : 'green'} subtext="validation failed" />
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
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>
            No certificate data yet. Run a check from a domain's Overview tab, or wait for the daily sweep.
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Hostname</th>
                <th style={headCell}>Domain</th>
                <th style={headCell}>Issuer</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Days left</th>
                <th style={headCell}>Expires</th>
                <th style={headCell}>Status</th>
                <th style={headCell}>Checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.domainId}:${r.hostname}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12 }}>{r.hostname}</td>
                  <td style={bodyCell}>
                    <Link href={`/domains/${r.domainId}`} style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>{r.domain}</Link>
                  </td>
                  <td style={{ ...bodyCell, fontSize: 12, color: 'var(--text2)' }}>{r.issuer ?? '—'}</td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', textAlign: 'right', color: r.daysUntilExpiry != null ? (r.daysUntilExpiry < 7 ? 'var(--red)' : r.daysUntilExpiry < 30 ? 'var(--amber)' : 'var(--green)') : 'var(--text3)' }}>
                    {r.daysUntilExpiry ?? '—'}
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    {r.validTo ? r.validTo.toISOString().slice(0, 10) : '—'}
                  </td>
                  <td style={bodyCell}>
                    {r.error ? <StatusBadge tone="critical">error</StatusBadge>
                    : r.authorized === false ? <StatusBadge tone="warning">untrusted</StatusBadge>
                    : <StatusBadge tone={daysTone(r.daysUntilExpiry)}>ok</StatusBadge>}
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    {relativeTime(r.checkedAt)}
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

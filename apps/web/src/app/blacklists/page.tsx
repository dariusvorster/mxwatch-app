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

export default function BlacklistsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const overview = trpc.activity.blacklistOverview.useQuery(undefined, { enabled: !!session });
  const active = trpc.delist.active.useQuery(undefined, { enabled: !!session });
  const utils = trpc.useUtils();
  const runCheck = trpc.checks.runBlacklist.useMutation({
    onSuccess: () => utils.activity.blacklistOverview.invalidate(),
  });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const rows = overview.data ?? [];
  const checked = rows.filter((r) => r.lastCheckedAt != null).length;
  const listed = rows.filter((r) => r.isListed).length;
  const clean = checked - listed;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader title="Blacklists" subtitle="Current RBL status for every sending IP you monitor." />

      <div style={{ fontSize: 12 }}>
        <Link href="/blacklists/history" style={{ color: 'var(--blue)' }}>
          View delist history →
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <SummaryCard label="Domains" value={rows.length} valueTone="blue" subtext="with a sending IP" />
        <SummaryCard label="Clean" value={clean} valueTone="green" subtext="passed latest check" />
        <SummaryCard label="Listed" value={listed} valueTone={listed > 0 ? 'red' : 'green'} subtext={listed > 0 ? 'action required' : 'nothing to fix'} />
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
                <th style={headCell}>Sending IP</th>
                <th style={headCell}>Status</th>
                <th style={headCell}>Last checked</th>
                <th style={headCell}>Listed on</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={bodyCell}>
                    <Link href={`/domains/${r.id}`} style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                      {r.domain}
                    </Link>
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>
                    {r.sendingIp ?? '—'}
                  </td>
                  <td style={bodyCell}>
                    {r.lastCheckedAt == null ? (
                      <StatusBadge tone="neutral">not checked</StatusBadge>
                    ) : r.isListed ? (
                      <StatusBadge tone="critical">{r.listedOn.length} listed</StatusBadge>
                    ) : (
                      <StatusBadge tone="healthy">clean</StatusBadge>
                    )}
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    {r.lastCheckedAt ? relativeTime(r.lastCheckedAt) : '—'}
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>
                    {r.listedOn.length > 0 ? r.listedOn.join(', ') : '—'}
                  </td>
                  <td style={{ ...bodyCell, textAlign: 'right' }}>
                    {r.sendingIp ? (
                      <button
                        type="button"
                        onClick={() => runCheck.mutate({ domainId: r.id, ip: r.sendingIp! })}
                        disabled={runCheck.isPending}
                        style={actionBtn}
                      >
                        Run
                      </button>
                    ) : (
                      <Link href={`/domains/${r.id}`} style={linkBtn}>Configure</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(active.data ?? []).length > 0 && (
        <div
          style={{
            background: 'var(--surf)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
            Active delist requests
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>
              across all your domains
            </span>
          </div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Domain</th>
                <th style={headCell}>RBL</th>
                <th style={headCell}>Listed value</th>
                <th style={headCell}>Status</th>
                <th style={headCell}>Last polled</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {(active.data ?? []).map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={bodyCell}>
                    <Link href={`/domains/${r.domainId}`} style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                      {r.domain}
                    </Link>
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12 }}>{r.rblName}</td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>
                    {r.listedValue}
                  </td>
                  <td style={bodyCell}>
                    <StatusBadge
                      tone={
                        r.status === 'pending'
                          ? 'warning'
                          : r.status === 'submitted'
                          ? 'info'
                          : 'neutral'
                      }
                    >
                      {r.status.replace('_', ' ')}
                    </StatusBadge>
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    {r.lastPolledAt ? relativeTime(r.lastPolledAt) : '—'}
                  </td>
                  <td style={{ ...bodyCell, textAlign: 'right' }}>
                    <Link href={`/domains/${r.domainId}?tab=blacklists`} style={linkBtn}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
const actionBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'var(--blue)',
  color: '#fff',
  border: '1px solid var(--blue)',
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text2)',
  border: '1px solid var(--border2)',
};

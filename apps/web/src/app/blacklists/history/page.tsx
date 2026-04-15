'use client';
import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

type TimelineEvent = { ts: string; event: string; detail?: string };

function parseTimeline(raw: string | null | undefined): TimelineEvent[] {
  try { return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

function durationLabel(start: Date | string | null, end: Date | string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function BlacklistsHistoryPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const history = trpc.delist.history.useQuery(undefined, { enabled: !!session });
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;
  const rows = history.data ?? [];

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Delist history"
        subtitle="Cleared, rejected, and expired delist requests across every domain."
      />
      <div style={{ fontSize: 12 }}>
        <Link href="/blacklists" style={{ color: 'var(--blue)' }}>← Back to blacklists</Link>
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
            Nothing resolved yet — delist requests appear here once they clear, expire, or are rejected.
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Domain</th>
                <th style={headCell}>RBL</th>
                <th style={headCell}>Listed value</th>
                <th style={headCell}>Outcome</th>
                <th style={headCell}>Time to resolve</th>
                <th style={headCell}>When</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openId === r.id;
                const timeline = parseTimeline(r.timeline);
                const tone: 'healthy' | 'warning' | 'critical' =
                  r.status === 'cleared' ? 'healthy' : r.status === 'expired' ? 'warning' : 'critical';
                const resolvedAt = r.clearedAt ?? timeline[timeline.length - 1]?.ts ?? null;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
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
                        <StatusBadge tone={tone}>{r.status}</StatusBadge>
                      </td>
                      <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>
                        {durationLabel(r.submittedAt ?? r.createdAt, resolvedAt)}
                      </td>
                      <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                        {resolvedAt ? relativeTime(resolvedAt) : relativeTime(r.createdAt)}
                      </td>
                      <td style={{ ...bodyCell, textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : r.id)}
                          style={linkBtn}
                        >
                          {open ? 'Hide' : 'Timeline'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr style={{ background: 'var(--surf2)' }}>
                        <td colSpan={7} style={{ padding: '12px 18px' }}>
                          {timeline.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--text3)' }}>No timeline entries recorded.</div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                              {timeline.map((e, i) => (
                                <li key={i} style={{ marginBottom: 4 }}>
                                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', marginRight: 8 }}>
                                    {new Date(e.ts).toLocaleString()}
                                  </span>
                                  <span style={{ fontWeight: 500 }}>{e.event}</span>
                                  {e.detail && <span style={{ color: 'var(--text2)' }}> — {e.detail}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
const linkBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text2)',
  border: '1px solid var(--border2)',
  cursor: 'pointer',
};

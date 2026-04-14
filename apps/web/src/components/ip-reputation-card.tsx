'use client';
import { trpc } from '@/lib/trpc';
import { ScoreRing } from '@/components/score-ring';
import { StatusBadge } from '@/components/status-badge';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { relativeTime } from '@/lib/alert-display';

function formatDuration(ms: number | null) {
  if (ms == null) return 'still active';
  const h = ms / (1000 * 60 * 60);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function IpReputationCard({ domainId }: { domainId: string }) {
  const current = trpc.ipReputation.current.useQuery({ domainId });
  const history = trpc.ipReputation.history.useQuery({ domainId, days: 90 });
  const incidents = trpc.ipReputation.incidents.useQuery({ domainId, days: 90 });

  const series = (history.data ?? []).map((r) => ({
    // chart expects a numeric x-axis for smooth time ticks
    t: new Date(r.checkedAt).getTime(),
    date: new Date(r.checkedAt).toISOString().slice(0, 10),
    score: r.score,
  }));
  const hasData = series.length > 0;

  return (
    <div
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14 }}>
        {current.data ? (
          <ScoreRing score={current.data.score} size={52} strokeWidth={4} />
        ) : (
          <ScoreRing score={0} size={52} strokeWidth={4} hideLabel />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>IP reputation</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {current.data
              ? <>IP <span style={{ color: 'var(--text2)' }}>{current.data.ip ?? '—'}</span> · checked {relativeTime(current.data.checkedAt)}</>
              : 'No checks yet — configure a sending IP on this domain.'}
          </div>
        </div>
        {current.data && (
          <StatusBadge tone={current.data.score >= 80 ? 'healthy' : current.data.score >= 60 ? 'warning' : 'critical'}>
            {current.data.listedOn.length > 0 ? `${current.data.listedOn.length} listed` : 'clean'}
          </StatusBadge>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {!hasData ? (
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>No reputation history yet. Run a blacklist check to populate.</p>
        ) : (
          <div style={{ height: 180, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(t: number) => new Date(t).toISOString().slice(5, 10)}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  labelFormatter={(t: number) => new Date(t).toLocaleString()}
                  formatter={(v: number) => [`${v}/100`, 'score']}
                />
                <Line type="monotone" dataKey="score" stroke="hsl(222 47% 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {(incidents.data && incidents.data.length > 0) && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div
            style={{
              padding: '10px 14px',
              fontFamily: 'var(--sans)',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              background: 'var(--bg)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            Incidents (90d) — {incidents.data.length}
          </div>
          <div>
            {incidents.data.slice(0, 12).map((inc, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <StatusBadge tone={inc.end == null ? 'critical' : 'warning'}>
                  {inc.end == null ? 'active' : 'resolved'}
                </StatusBadge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text)' }}>{inc.rbl}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                    {inc.ip ?? '—'} · started {new Date(inc.start).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
                  {formatDuration(inc.durationMs)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

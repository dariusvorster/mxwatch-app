'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { relativeTime } from '@/lib/alert-display';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Filter = 'all' | 'errors' | 'jobs';

const LEVEL_COLOR: Record<Level, { bg: string; fg: string }> = {
  debug: { bg: 'var(--surf2)', fg: 'var(--text3)' },
  info: { bg: 'var(--blue-dim)', fg: 'var(--blue)' },
  warn: { bg: 'var(--amber-dim)', fg: 'var(--amber)' },
  error: { bg: 'var(--red-dim)', fg: 'var(--red)' },
};
const STATUS_COLOR: Record<string, string> = {
  success: 'var(--green)', partial: 'var(--amber)', failed: 'var(--red)', running: 'var(--text3)',
};

/**
 * Logs tab for the domain-detail page. All All/Errors/Jobs is a client-side
 * filter over two queries (logs + jobRuns) rather than three separate
 * endpoints, since the data volumes are small and we avoid a round-trip on
 * every toggle.
 */
export function DomainLogsTab({ domainId }: { domainId: string }) {
  const [filter, setFilter] = useState<Filter>('all');

  const logs = trpc.logs.byDomain.useQuery({
    domainId, limit: 200,
    level: filter === 'errors' ? 'error' : undefined,
  });
  const jobs = trpc.logs.jobRuns.useQuery({ domainId, limit: 20 });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', width: 'fit-content' }}>
        {(['all', 'errors', 'jobs'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '5px 14px', fontSize: 11, fontFamily: 'var(--sans)', cursor: 'pointer',
              border: 'none', borderRadius: 6,
              background: filter === f ? 'var(--surf)' : 'transparent',
              color: filter === f ? 'var(--text)' : 'var(--text3)',
              fontWeight: filter === f ? 500 : 400,
            }}>{f === 'all' ? 'All' : f === 'errors' ? 'Errors' : 'Jobs'}</button>
        ))}
      </div>

      {filter !== 'errors' && (
        <Card>
          <CardHeader><CardTitle>Recent job runs</CardTitle></CardHeader>
          <CardContent>
            {(jobs.data?.length ?? 0) === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>No job runs recorded for this domain yet.</div>
            ) : (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                {(jobs.data ?? []).map((j) => (
                  <div key={j.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 0.8fr 2fr', padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                    <span style={{ color: STATUS_COLOR[j.status] ?? 'var(--text)' }}>
                      {j.status === 'success' ? '✓' : j.status === 'partial' ? '⚠' : j.status === 'failed' ? '✗' : '·'} {j.status}
                    </span>
                    <span style={{ color: 'var(--text)' }}>{j.jobName}</span>
                    <span style={{ color: 'var(--text3)' }}>{relativeTime(j.startedAt)}</span>
                    <span style={{ color: 'var(--text3)' }}>{j.durationMs != null ? `${j.durationMs}ms` : '—'}</span>
                    <span style={{ color: 'var(--text3)' }}>
                      {j.itemsSucceeded != null && `✓${j.itemsSucceeded}`}
                      {j.itemsFailed != null && j.itemsFailed > 0 && <> <span style={{ color: 'var(--red)' }}>✗{j.itemsFailed}</span></>}
                      {j.errorMessage && <> · {j.errorMessage.slice(0, 60)}</>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {filter !== 'jobs' && (
        <Card>
          <CardHeader><CardTitle>Log entries</CardTitle></CardHeader>
          <CardContent>
            {(logs.data?.length ?? 0) === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>No log entries{filter === 'errors' ? ' at error level' : ''}.</div>
            ) : (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                {(logs.data ?? []).map((l) => {
                  const color = LEVEL_COLOR[l.level as Level] ?? LEVEL_COLOR.info;
                  const isOpen = expanded === l.id;
                  return (
                    <div key={l.id}
                      onClick={() => setExpanded(isOpen ? null : l.id)}
                      style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.5fr 0.8fr 3fr', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text3)' }}>{new Date(l.createdAt).toISOString().slice(11, 19)}Z</span>
                        <span style={{ background: color.bg, color: color.fg, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', fontSize: 9, fontWeight: 500, textAlign: 'center', width: 'fit-content' }}>
                          {l.level}
                        </span>
                        <span style={{ color: 'var(--text2)' }}>{l.category}</span>
                        <span style={{ color: 'var(--text)' }}>{l.message}</span>
                      </div>
                      {isOpen && (
                        <pre style={{ marginTop: 6, padding: 8, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10, color: 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{JSON.stringify({
  durationMs: l.durationMs,
  error: l.error,
  detail: l.detail ? JSON.parse(l.detail) : undefined,
  stack: l.stack,
}, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

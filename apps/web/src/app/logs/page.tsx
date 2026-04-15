'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/alert-display';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_COLOR: Record<Level, { bg: string; fg: string }> = {
  debug: { bg: 'var(--surf2)', fg: 'var(--text3)' },
  info: { bg: 'var(--blue-dim)', fg: 'var(--blue)' },
  warn: { bg: 'var(--amber-dim)', fg: 'var(--amber)' },
  error: { bg: 'var(--red-dim)', fg: 'var(--red)' },
};

const STATUS_COLOR: Record<string, string> = {
  success: 'var(--green)',
  partial: 'var(--amber)',
  failed: 'var(--red)',
  running: 'var(--text3)',
};

export default function LogsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, isPending } = useSession();

  const [level, setLevel] = useState<Level | ''>((params.get('level') as Level) ?? '');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const utils = trpc.useUtils();
  const logs = trpc.logs.list.useQuery(
    {
      level: level || undefined,
      category: category || undefined,
      search: search || undefined,
      limit: 200,
    },
    { enabled: !!session },
  );
  const jobs = trpc.logs.jobRuns.useQuery({ limit: 10 }, { enabled: !!session });

  async function download() {
    const from = new Date(Date.now() - 7 * 86400 * 1000);
    const to = new Date();
    const ndjson = await utils.logs.download.fetch({ from, to });
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mxwatch-logs-${to.toISOString().slice(0, 10)}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Application logs
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Structured logs from jobs, auth, and system events
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={level} onChange={(e) => setLevel(e.target.value as Level | '')}
          style={selectStyle}>
          <option value="">any level</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <Input placeholder="category (dns, rbl, auth…)" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 200 }} />
        <Input placeholder="search messages" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        <Button variant="outline" onClick={download}>Download (7d)</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent job runs</CardTitle></CardHeader>
        <CardContent>
          {(jobs.data?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No job runs recorded yet.</div>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {(jobs.data ?? []).map((j) => (
                <div key={j.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 0.8fr 2fr', padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                  <span style={{ color: STATUS_COLOR[j.status] ?? 'var(--text)' }}>
                    {j.status === 'success' ? '✓'
                      : j.status === 'partial' ? '⚠'
                      : j.status === 'failed' ? '✗'
                      : '·'} {j.status}
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

      <Card>
        <CardHeader><CardTitle>Log entries</CardTitle></CardHeader>
        <CardContent>
          {(logs.data?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No matching log entries.</div>
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
  domainId: l.domainId,
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
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--surf)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)',
  fontFamily: 'var(--sans)', fontSize: 13,
};

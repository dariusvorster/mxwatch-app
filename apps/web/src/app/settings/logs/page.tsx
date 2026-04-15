'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: { value: Level; title: string; desc: string }[] = [
  { value: 'debug', title: 'Debug', desc: 'Very verbose — for troubleshooting only.' },
  { value: 'info',  title: 'Info',  desc: 'Recommended. Job starts/completions + notable events.' },
  { value: 'warn',  title: 'Warn',  desc: 'Warnings and errors only.' },
  { value: 'error', title: 'Error', desc: 'Errors only.' },
];

export default function LogsSettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const utils = trpc.useUtils();
  const level = trpc.logs.logLevelGet.useQuery(undefined, { enabled: !!session });
  const setLevel = trpc.logs.logLevelSet.useMutation({ onSuccess: () => level.refetch() });
  const clear = trpc.logs.clear.useMutation();
  const [confirm, setConfirm] = useState('');

  async function download() {
    const from = new Date(Date.now() - 30 * 86400 * 1000);
    const to = new Date();
    const ndjson = await utils.logs.download.fetch({ from, to });
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mxwatch-logs-${to.toISOString().slice(0, 10)}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doClear() {
    if (confirm !== 'CLEAR LOGS') return;
    await clear.mutateAsync({ confirm: 'CLEAR LOGS' });
    setConfirm('');
  }

  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 680 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Logging
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Retention: 30 days rolling · NDJSON file + SQLite sink
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Log level</CardTitle></CardHeader>
        <CardContent style={{ display: 'grid', gap: 8 }}>
          {LEVELS.map((l) => (
            <label key={l.value}
              style={{
                display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer',
                border: `1px solid ${level.data === l.value ? 'var(--blue-border)' : 'var(--border)'}`,
                background: level.data === l.value ? 'var(--blue-dim)' : 'var(--surf)',
                borderRadius: 'var(--radius-sm)',
              }}>
              <input
                type="radio"
                name="level"
                value={l.value}
                checked={level.data === l.value}
                onChange={() => setLevel.mutate(l.value)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{l.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l.desc}</div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Export</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={download}>Download last 30 days (NDJSON)</Button>
        </CardContent>
      </Card>

      <Card style={{ borderColor: 'var(--red-border)' }}>
        <CardHeader>
          <CardTitle style={{ color: 'var(--red)' }}>Clear logs</CardTitle>
          <CardDescription>Removes every log row visible to your account. Irreversible.</CardDescription>
        </CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label>Type <code>CLEAR LOGS</code> to confirm</Label>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="CLEAR LOGS" style={{ maxWidth: 260 }} />
          <Button variant="outline" onClick={doClear} disabled={confirm !== 'CLEAR LOGS' || clear.isPending} style={{ color: 'var(--red)' }}>
            {clear.isPending ? 'Clearing…' : 'Clear logs'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

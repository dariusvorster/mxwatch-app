'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SummaryCard } from '@/components/summary-card';
import { relativeTime } from '@/lib/alert-display';

const addSchema = z.object({
  domain: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'Invalid domain'),
  label: z.string().trim().max(100).optional(),
});

export default function WatchedPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const list = trpc.watched.list.useQuery(undefined, { enabled: !!session });
  const utils = trpc.useUtils();
  const add = trpc.watched.add.useMutation({ onSuccess: () => utils.watched.list.invalidate() });
  const remove = trpc.watched.remove.useMutation({ onSuccess: () => utils.watched.list.invalidate() });
  const runNow = trpc.watched.runNow.useMutation({ onSuccess: () => utils.watched.list.invalidate() });

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = addSchema.safeParse({
      domain: fd.get('domain'),
      label: (fd.get('label') as string) || undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid input');
    try {
      await add.mutateAsync({ ...parsed.data, alertOnRblListing: true, alertOnDmarcChange: false });
      form.reset();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add');
    }
  }

  const rows = list.data ?? [];
  const total = rows.length;
  const listed = rows.filter((r) => (r.latest?.rblListedCount ?? 0) > 0).length;
  const noDmarc = rows.filter((r) => r.latest && !r.latest.dmarcValid).length;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader title="Watched domains" subtitle="Monitor external domains you don't own — RBL, DMARC policy, MX. No verification required." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <SummaryCard label="Watching" value={total} valueTone="blue" />
        <SummaryCard label="Listed" value={listed} valueTone={listed > 0 ? 'red' : 'green'} subtext="on any RBL" />
        <SummaryCard label="No DMARC" value={noDmarc} valueTone={noDmarc > 0 ? 'amber' : 'green'} />
      </div>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add a domain</div>
        <form onSubmit={onAdd} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            name="domain"
            required
            placeholder="competitor.com"
            style={{ flex: 1, minWidth: 220, height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12 }}
          />
          <input
            name="label"
            placeholder="Label (optional)"
            style={{ flex: 1, minWidth: 180, height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 12 }}
          />
          <button
            type="submit"
            disabled={add.isPending}
            style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '0 14px', height: 36, borderRadius: 7, background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', cursor: 'pointer' }}
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</p>}
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
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>Not watching any external domains yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={headCell}>Domain</th>
                <th style={headCell}>Label</th>
                <th style={headCell}>DMARC</th>
                <th style={headCell}>RBL</th>
                <th style={headCell}>MX</th>
                <th style={headCell}>Checked</th>
                <th style={{ ...headCell, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const l = w.latest;
                const listedCount = l?.rblListedCount ?? 0;
                return (
                  <tr key={w.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)' }}>{w.domain}</td>
                    <td style={{ ...bodyCell, fontSize: 12, color: 'var(--text2)' }}>{w.label ?? '—'}</td>
                    <td style={bodyCell}>
                      {!l ? <StatusBadge tone="neutral">pending</StatusBadge>
                      : l.dmarcPolicy === 'reject' ? <StatusBadge tone="healthy">p=reject</StatusBadge>
                      : l.dmarcPolicy === 'quarantine' ? <StatusBadge tone="warning">p=quarantine</StatusBadge>
                      : l.dmarcPolicy === 'none' ? <StatusBadge tone="warning">p=none</StatusBadge>
                      : <StatusBadge tone="critical">no DMARC</StatusBadge>}
                    </td>
                    <td style={bodyCell}>
                      {!l ? <StatusBadge tone="neutral">—</StatusBadge>
                      : l.resolvedIp == null ? <StatusBadge tone="neutral">no MX</StatusBadge>
                      : listedCount > 0 ? <StatusBadge tone="critical">{listedCount} listed</StatusBadge>
                      : <StatusBadge tone="healthy">clean</StatusBadge>}
                    </td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
                      {l?.mx?.[0] ?? '—'}
                      {l?.resolvedIp && <span style={{ color: 'var(--text3)' }}> · {l.resolvedIp}</span>}
                    </td>
                    <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                      {l?.checkedAt ? relativeTime(l.checkedAt) : '—'}
                    </td>
                    <td style={{ ...bodyCell, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" onClick={() => runNow.mutate({ id: w.id })} disabled={runNow.isPending} style={actionBtn}>Run</button>
                        <button
                          type="button"
                          onClick={() => { if (confirm(`Stop watching ${w.domain}?`)) remove.mutate({ id: w.id }); }}
                          style={removeBtn}
                        >
                          Remove
                        </button>
                      </div>
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
const removeBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--red)',
  border: '1px solid var(--red-border)',
  cursor: 'pointer',
};

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { ScoreRing, scoreTier } from '@/components/score-ring';

type CheckResult = { pass: boolean; score: number; max: number; message: string; fix?: string };

export default function DeliverabilityPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [testId, setTestId] = useState<string | null>(null);
  const create = trpc.deliverability.create.useMutation({ onSuccess: (r) => setTestId(r.id) });
  const test = trpc.deliverability.get.useQuery(
    { id: testId! },
    {
      enabled: !!testId,
      refetchInterval: (q) => {
        const s = q.state?.data?.status;
        return s === 'analyzed' || s === 'expired' ? false : 5000;
      },
    },
  );
  const history = trpc.deliverability.history.useQuery({ limit: 10 }, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const row = test.data;
  const score10 = row?.scoreOutOf10 ?? null;
  const checks = row?.results as Record<string, CheckResult> | null;

  return (
    <div className="space-y-5" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Deliverability test"
        subtitle="Send an email from your mail server to a unique inbox. MxWatch scores it like mail-tester."
      />

      {!testId && (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Press the button to generate a unique test inbox valid for 10 minutes. Then send an email to that address from the domain you want to test.
          </p>
          <button
            type="button"
            onClick={() => create.mutate({})}
            disabled={create.isPending}
            style={{
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
              padding: '9px 16px', borderRadius: 7,
              background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)',
              cursor: 'pointer',
            }}
          >
            {create.isPending ? 'Creating…' : 'Generate test inbox'}
          </button>
        </div>
      )}

      {testId && row && row.status !== 'analyzed' && (
        <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>
            Send a test email to this address:
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <pre style={{ flex: 1, margin: 0, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 13 }}>
              {row.testAddress}
            </pre>
            <button
              type="button"
              onClick={async () => { try { await navigator.clipboard.writeText(row.testAddress); } catch {} }}
              style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, padding: '7px 12px', borderRadius: 7, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border2)', cursor: 'pointer' }}
            >
              Copy
            </button>
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)' }}>
            {row.status === 'pending' && 'Waiting for the email to arrive… (polling every 5s)'}
            {row.status === 'received' && 'Email received. Analysing…'}
            {row.status === 'expired' && 'Test inbox expired. Generate a new one to retry.'}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
            Expires {new Date(row.expiresAt).toLocaleTimeString()}
          </div>
          <button
            type="button"
            onClick={() => setTestId(null)}
            style={{ alignSelf: 'flex-start', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Cancel
          </button>
        </div>
      )}

      {row && row.status === 'analyzed' && checks && score10 != null && (
        <>
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 20 }}>
            <ScoreRing score={Math.round(score10 * 10)} size={80} strokeWidth={6} hideLabel />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 36, fontWeight: 600, color: tierColor(scoreTier(score10 * 10)), lineHeight: 1 }}>
                {score10.toFixed(1)} <span style={{ fontSize: 18, color: 'var(--text3)' }}>/ 10</span>
              </div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                from {row.fromAddress ?? '—'} · source IP {row.sourceIp ?? '—'} · subject "{row.subject ?? '—'}"
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setTestId(null); create.mutate({}); }}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', cursor: 'pointer' }}
            >
              Run again
            </button>
          </div>

          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {Object.entries(checks).map(([key, c], i) => (
              <div key={key} style={{ padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <StatusBadge tone={c.pass ? 'healthy' : 'critical'}>{c.pass ? 'pass' : 'fail'}</StatusBadge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500 }}>{labelFor(key)}</div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)' }}>{c.message}</div>
                  {c.fix && !c.pass && (
                    <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                      <strong>Fix:</strong> {c.fix}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.pass ? 'var(--green)' : 'var(--text3)' }}>
                  {c.score.toFixed(1)} / {c.max.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {history.data && history.data.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Past tests
          </div>
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {history.data.map((h, i) => (
              <div
                key={h.id}
                style={{ padding: '10px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => setTestId(h.id)}
              >
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: h.scoreOutOf10 != null ? tierColor(scoreTier((h.scoreOutOf10) * 10)) : 'var(--text3)' }}>
                  {h.scoreOutOf10 != null ? `${h.scoreOutOf10.toFixed(1)} / 10` : '—'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.subject ?? '—'}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                    {h.fromAddress ?? '—'} · {new Date(h.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge tone={h.status === 'analyzed' ? 'healthy' : h.status === 'expired' ? 'neutral' : 'info'}>{h.status}</StatusBadge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function labelFor(key: string): string {
  switch (key) {
    case 'spf': return 'SPF';
    case 'dkim': return 'DKIM';
    case 'dmarc': return 'DMARC';
    case 'reverseDns': return 'Reverse DNS matches HELO';
    case 'noRbl': return 'Sender IP not on any RBL';
    case 'helo': return 'HELO is a valid hostname';
    case 'htmlTextRatio': return 'HTML / text balance';
    case 'noSuspiciousLinks': return 'No shortener links';
    case 'subjectOk': return 'Subject not spammy';
    case 'bodyOk': return 'Body not spammy';
    default: return key;
  }
}

function tierColor(t: ReturnType<typeof scoreTier>): string {
  return t === 'good' ? 'var(--green)' : t === 'warn' ? 'var(--amber)' : 'var(--red)';
}

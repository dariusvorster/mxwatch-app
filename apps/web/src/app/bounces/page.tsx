'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/alert-display';

function toneFor(type: string): { bg: string; fg: string } {
  if (type === 'policy') return { bg: 'var(--red-dim)', fg: 'var(--red)' };
  if (type === 'hard') return { bg: 'var(--amber-dim)', fg: 'var(--amber)' };
  return { bg: 'var(--blue-dim)', fg: 'var(--blue)' };
}

export default function BouncesPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const list = trpc.bounces.list.useQuery({ limit: 200 }, { enabled: !!session });
  const ack = trpc.bounces.acknowledge.useMutation({ onSuccess: () => list.refetch() });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>Bounces</h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Unified feed across all domains · {list.data?.length ?? 0} recent
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent bounces</CardTitle></CardHeader>
        <CardContent>
          {(list.data?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No bounces recorded.</div>
          ) : (
            <div>
              {(list.data ?? []).map((b) => {
                const t = toneFor(b.bounceType);
                return (
                  <div key={b.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span style={{ padding: '2px 8px', fontSize: 10, borderRadius: 10, background: t.bg, color: t.fg, textTransform: 'uppercase', fontWeight: 500 }}>
                          {b.bounceType}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                          <Link href={`/domains/${b.domainId}`} style={{ textDecoration: 'underline' }}>{b.domainName}</Link>
                          {' → '}
                          {b.originalTo}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                          {relativeTime(b.timestamp)}
                        </span>
                        {!b.acknowledged && (
                          <Button size="sm" variant="ghost" onClick={() => ack.mutate({ id: b.id })}>ack</Button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4, paddingLeft: 8 }}>
                      {b.errorCode} · {b.errorMessage?.slice(0, 160)}
                      {b.relatedRBL && <span style={{ color: 'var(--red)' }}> · RBL: {b.relatedRBL}</span>}
                    </div>
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

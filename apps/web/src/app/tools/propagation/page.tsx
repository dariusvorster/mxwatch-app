'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type RecordType = 'TXT' | 'MX' | 'A' | 'AAAA';

export default function PropagationPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const check = trpc.propagation.check.useMutation();

  const [domainId, setDomainId] = useState('');
  const [recordType, setRecordType] = useState<RecordType>('TXT');
  const [hostname, setHostname] = useState('');
  const [expected, setExpected] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  useEffect(() => {
    if (!domainId && domains.data && domains.data.length > 0) setDomainId(domains.data[0]!.id);
  }, [domains.data, domainId]);

  async function run() {
    setError(null);
    try {
      await check.mutateAsync({
        domainId,
        recordType,
        hostname: hostname.trim() || undefined,
        expectedValue: expected.trim() || undefined,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Check failed');
    }
  }

  const grouped = useMemo(() => {
    const out: Record<string, typeof check.data extends infer T ? T extends { results: infer R } ? R : never : never> = {} as any;
    for (const r of check.data?.results ?? []) {
      const region = r.region ?? 'Other';
      (out[region] ??= [] as any).push(r);
    }
    return out as Record<string, NonNullable<typeof check.data>['results']>;
  }, [check.data]);

  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 980 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          DNS Propagation Checker
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Queries 19 public resolvers across 5 regions
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run a check</CardTitle>
          <CardDescription>Pick a domain and record type. Optional: override hostname (e.g. <code>_dmarc.example.com</code>) and supply a substring the resolver result must contain.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <select id="domain" value={domainId} onChange={(e) => setDomainId(e.target.value)}
                style={selectStyle}>
                {(domains.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.domain}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recordType">Record type</Label>
              <select id="recordType" value={recordType} onChange={(e) => setRecordType(e.target.value as RecordType)}
                style={selectStyle}>
                <option value="TXT">TXT</option>
                <option value="MX">MX</option>
                <option value="A">A</option>
                <option value="AAAA">AAAA</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hostname">Hostname override (optional)</Label>
            <Input id="hostname" value={hostname} onChange={(e) => setHostname(e.target.value)}
              placeholder="e.g. _dmarc.example.com or mail._domainkey.example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expected">Expected value contains (optional)</Label>
            <Input id="expected" value={expected} onChange={(e) => setExpected(e.target.value)}
              placeholder="e.g. v=spf1 include:_spf.google.com" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={run} disabled={!domainId || check.isPending}>
            {check.isPending ? 'Querying…' : 'Check propagation'}
          </Button>
        </CardContent>
      </Card>

      {check.data && (
        <Card>
          <CardHeader>
            <CardTitle>
              Results — {check.data.hostname} ({check.data.recordType})
            </CardTitle>
            <CardDescription>
              {check.data.propagatedCount} / {check.data.totalResolvers} resolvers
              {check.data.expectedValue ? ` matched "${check.data.expectedValue}"` : ' returned a record'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.entries(grouped).map(([region, rows]) => (
              <div key={region} style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  {region}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {rows.map((r) => {
                    const ok = check.data!.expectedValue ? r.matches === true : r.values.length > 0 && !r.error;
                    const color = r.error ? 'var(--red)' : ok ? 'var(--green)' : 'var(--amber)';
                    return (
                      <div key={`${region}-${r.resolver}-${r.ip}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1.2fr 1fr 4fr', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--text)' }}>{r.resolver}</span>
                        <span style={{ color: 'var(--text3)' }}>{r.ip}</span>
                        <span style={{ color }}>
                          {r.error
                            ? `error: ${r.error}`
                            : r.values.length === 0
                              ? '(no record)'
                              : r.values.join(' ; ').slice(0, 220)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'var(--surf)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)',
  fontFamily: 'var(--sans)', fontSize: 13,
};

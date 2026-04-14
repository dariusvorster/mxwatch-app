'use client';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

function formatPct(n: number | null | undefined, digits = 2) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function repVariant(rep: string | null): 'success' | 'warning' | 'destructive' | 'outline' {
  switch (rep) {
    case 'HIGH': return 'success';
    case 'MEDIUM': return 'warning';
    case 'LOW': return 'warning';
    case 'BAD': return 'destructive';
    default: return 'outline';
  }
}

export function PostmasterCard({ domainId }: { domainId: string }) {
  const status = trpc.google.status.useQuery();
  const stats = trpc.google.domainStats.useQuery({ domainId, days: 30 });

  if (status.isLoading || stats.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!status.data?.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Postmaster Tools not configured</CardTitle>
          <CardDescription>Set <code>GOOGLE_CLIENT_ID</code> + <code>GOOGLE_CLIENT_SECRET</code> in your environment to enable this integration.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><Link href="/settings/google">Open settings</Link></Button>
        </CardContent>
      </Card>
    );
  }
  if (!status.data.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Google Postmaster Tools</CardTitle>
          <CardDescription>MxWatch will sync Gmail-side spam rate, IP reputation, and delivery errors for this domain once connected and verified.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild><Link href="/settings/google">Connect</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const rows = stats.data ?? [];
  const latest = rows[0];

  if (!latest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No stats yet</CardTitle>
          <CardDescription>
            Connected as {status.data.googleEmail}. Either this domain isn't verified in <a href="https://postmaster.google.com" target="_blank" rel="noreferrer" className="underline">postmaster.google.com</a>, or the first daily sync hasn't run yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Last sync: {status.data.lastSyncAt ? new Date(status.data.lastSyncAt).toLocaleString() : 'never'} ·
            Automatic sync runs daily at 04:00 UTC. Trigger a manual sync from <Link href="/settings/google" className="underline">Settings → Google</Link>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const spamSeries = [...rows]
    .reverse()
    .map((r) => ({ date: r.date, spam: r.spamRate != null ? r.spamRate * 100 : null }))
    .filter((p) => p.spam != null);

  const ipBuckets = latest.ipReputations
    ? [
        { name: 'High', count: latest.ipReputations.high, color: 'hsl(142 71% 45%)' },
        { name: 'Medium', count: latest.ipReputations.medium, color: 'hsl(38 92% 50%)' },
        { name: 'Low', count: latest.ipReputations.low, color: 'hsl(25 95% 53%)' },
        { name: 'Bad', count: latest.ipReputations.bad, color: 'hsl(0 84% 60%)' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Latest ({latest.date})</span>
            <Badge variant={repVariant(latest.domainReputation)}>{latest.domainReputation ?? '—'}</Badge>
          </CardTitle>
          <CardDescription>Gmail Postmaster Tools · {status.data.googleEmail}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm md:grid-cols-4">
            <Stat label="Spam rate" value={latest.spamRate != null ? formatPct(latest.spamRate, 3) : '—'} />
            <Stat label="DKIM pass" value={formatPct(latest.dkimSuccessRatio)} />
            <Stat label="SPF pass" value={formatPct(latest.spfSuccessRatio)} />
            <Stat label="DMARC pass" value={formatPct(latest.dmarcSuccessRatio)} />
          </div>
        </CardContent>
      </Card>

      {spamSeries.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Spam rate — last 30 days</CardTitle></CardHeader>
          <CardContent>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spamSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(3)}%`} />
                  <Line type="monotone" dataKey="spam" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {ipBuckets.length > 0 && (
        <Card>
          <CardHeader><CardTitle>IP reputation buckets</CardTitle></CardHeader>
          <CardContent>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ipBuckets}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(222 47% 50%)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {latest.deliveryErrors && latest.deliveryErrors.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Delivery errors</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2">Type</th>
                  <th className="py-2">Class</th>
                  <th className="py-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {latest.deliveryErrors.map((e, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2 font-mono text-xs">{e.errorType}</td>
                    <td className="py-2 text-xs">{e.errorClass}</td>
                    <td className="py-2 text-right">{formatPct(e.errorRatio ?? 0, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

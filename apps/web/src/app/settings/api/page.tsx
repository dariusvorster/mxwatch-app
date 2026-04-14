'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';

export default function ApiTokensPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const tokens = trpc.settings.listApiTokens.useQuery(undefined, { enabled: !!session });
  const create = trpc.settings.createApiToken.useMutation({ onSuccess: () => tokens.refetch() });
  const revoke = trpc.settings.revokeApiToken.useMutation({ onSuccess: () => tokens.refetch() });
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main className="p-6">Loading…</main>;

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const label = (fd.get('label') as string) || undefined;
    const res = await create.mutateAsync({ label });
    setNewPlaintext(res.plaintext);
    form.reset();
  }

  async function copy() {
    if (!newPlaintext) return;
    try {
      await navigator.clipboard.writeText(newPlaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-6" style={{ maxWidth: 900 }}>
      <PageHeader
        title="API tokens"
        subtitle="Read-only access for scripts, dashboards, and integrations."
      />

      <Card>
        <CardHeader><CardTitle>Create token</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onCreate} className="flex gap-2">
            <input
              name="label"
              placeholder="Label (e.g. grafana-prod)"
              className="flex h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <Button type="submit" disabled={create.isPending}>Create</Button>
          </form>

          {newPlaintext && (
            <div className="rounded-md border border-border bg-[hsl(142_71%_45%/0.08)] p-3 space-y-2">
              <p className="text-sm font-medium">Copy this token now — it won't be shown again.</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 overflow-x-auto rounded border border-border bg-background p-2 text-xs font-mono">{newPlaintext}</pre>
                <Button size="sm" variant="outline" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Example usage</p>
              <pre className="overflow-x-auto rounded border border-border bg-background p-2 text-xs font-mono">{`curl ${appUrl}/api/v1/domains \\
  -H "Authorization: Bearer ${newPlaintext}"`}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 font-mono text-xs">
            <li>GET /api/v1/domains</li>
            <li>GET /api/v1/domains/{'{id}'}</li>
            <li>GET /api/v1/domains/{'{id}'}/dns?limit=50</li>
            <li>GET /api/v1/domains/{'{id}'}/reports?days=30&limit=100</li>
            <li>GET /api/v1/alerts?onlyActive=1</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            All endpoints require <code>Authorization: Bearer &lt;token&gt;</code> and are scoped to the issuing user's domains.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tokens ({tokens.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {tokens.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.data && tokens.data.length > 0 ? (
            <div className="divide-y divide-border">
              {tokens.data.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {t.label ?? t.tokenPrefix}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{t.tokenPrefix}…</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.revokedAt ? `Revoked ${new Date(t.revokedAt).toLocaleDateString()}` :
                        t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleString()}` : 'Never used'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.revokedAt ? <Badge variant="outline">Revoked</Badge> : <Badge variant="success">Active</Badge>}
                    {!t.revokedAt && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => { if (confirm('Revoke this token?')) revoke.mutate({ id: t.id }); }}
                        disabled={revoke.isPending}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

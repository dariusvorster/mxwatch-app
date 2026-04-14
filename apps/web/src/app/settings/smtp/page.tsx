'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DmarcSetup } from '@/components/dmarc-setup';
import { PageHeader } from '@/components/page-header';

export default function SmtpSettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const smtp = trpc.settings.smtpConfig.useQuery(undefined, { enabled: !!session });
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main>Loading…</main>;

  const first = domains.data?.[0]?.domain;

  return (
    <div className="space-y-6" style={{ maxWidth: 900 }}>
      <PageHeader
        title="SMTP ingest"
        subtitle="How DMARC aggregate reports reach MxWatch."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Listener status</span>
            {smtp.data?.disabled ? <Badge variant="destructive">Disabled</Badge> : <Badge variant="success">Running</Badge>}
          </CardTitle>
          <CardDescription>Set by <code>SMTP_PORT</code> and <code>NEXT_PUBLIC_APP_URL</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Hostname</span>
            <span className="font-mono">{smtp.data?.hostname}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Port</span>
            <span className="font-mono">{smtp.data?.port}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Address</span>
            <span className="font-mono">{smtp.data?.listenerAddress}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Setup guide</CardTitle></CardHeader>
        <CardContent>
          {smtp.data ? <DmarcSetup smtp={smtp.data} domain={first} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </CardContent>
      </Card>
    </div>
  );
}

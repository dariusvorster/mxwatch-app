'use client';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { severityFor, humanizeAlertType, severityBorderClass, relativeTime } from '@/lib/alert-display';
import { cn } from '@/lib/utils';

export function ActiveAlerts() {
  const alerts = trpc.alerts.history.useQuery({ onlyActive: true });
  const resolve = trpc.alerts.resolve.useMutation({ onSuccess: () => alerts.refetch() });

  if (alerts.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!alerts.data || alerts.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No active alerts. Nice.</p>;
  }

  return (
    <div className="space-y-2">
      {alerts.data.map((a) => {
        const sev = severityFor(a.type);
        return (
          <Card key={a.id} className={cn(severityBorderClass(sev))}>
            <CardContent className="flex items-start justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/domains/${a.domainId}`} className="font-medium hover:underline">
                    {a.domainName}
                  </Link>
                  <Badge variant={severityBadgeVariant(sev)}>{sev}</Badge>
                  <span className="text-xs text-muted-foreground">{humanizeAlertType(a.type)}</span>
                  <span className="text-xs text-muted-foreground">· {relativeTime(a.firedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-foreground">{a.message}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resolve.mutate({ id: a.id })}
                disabled={resolve.isPending}
              >
                Resolve
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function severityBadgeVariant(sev: 'critical' | 'high' | 'medium' | 'low') {
  if (sev === 'critical') return 'destructive' as const;
  if (sev === 'high') return 'destructive' as const;
  if (sev === 'medium') return 'warning' as const;
  return 'outline' as const;
}

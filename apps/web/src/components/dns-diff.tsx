'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface DnsSnapshot {
  id: string;
  checkedAt: Date | string | number;
  spfRecord: string | null;
  dkimSelector: string | null;
  dkimRecord: string | null;
  dmarcRecord: string | null;
  mxRecords: string | null;
  healthScore: number | null;
}

const FIELDS: Array<{ key: keyof DnsSnapshot; label: string }> = [
  { key: 'spfRecord', label: 'SPF' },
  { key: 'dkimRecord', label: 'DKIM' },
  { key: 'dmarcRecord', label: 'DMARC' },
  { key: 'mxRecords', label: 'MX' },
];

function diffFields(prev: DnsSnapshot | null, curr: DnsSnapshot) {
  const changed: Array<{ label: string; prev: string | null; curr: string | null }> = [];
  for (const f of FIELDS) {
    const prevVal = (prev?.[f.key] as string | null | undefined) ?? null;
    const currVal = (curr[f.key] as string | null | undefined) ?? null;
    if ((prevVal ?? '') !== (currVal ?? '')) {
      changed.push({ label: f.label, prev: prevVal, curr: currVal });
    }
  }
  return changed;
}

export function DnsHistoryList({ snapshots }: { snapshots: DnsSnapshot[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground">No snapshots yet.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {snapshots.map((snap, i) => {
        const prev = snapshots[i + 1] ?? null;
        const changes = diffFields(prev, snap);
        const isFirst = !prev;
        const isOpen = openId === snap.id;
        return (
          <div key={snap.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{new Date(snap.checkedAt).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  {isFirst ? 'Initial snapshot' : changes.length === 0 ? 'No changes' : `${changes.length} field${changes.length > 1 ? 's' : ''} changed: ${changes.map((c) => c.label).join(', ')}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {snap.healthScore != null && <Badge variant="outline">{snap.healthScore}/100</Badge>}
                {(changes.length > 0 || isFirst) && (
                  <Button size="sm" variant="outline" onClick={() => setOpenId(isOpen ? null : snap.id)}>
                    {isOpen ? 'Hide' : 'View'}
                  </Button>
                )}
              </div>
            </div>
            {isOpen && (
              <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                {isFirst ? (
                  <div className="space-y-2 text-xs">
                    {FIELDS.map((f) => (
                      <div key={f.key}>
                        <p className="font-medium">{f.label}</p>
                        <pre className="mt-1 whitespace-pre-wrap break-all rounded border border-border bg-background p-2 font-mono">{String(snap[f.key] ?? '—')}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  changes.map((c) => (
                    <div key={c.label} className="space-y-1">
                      <p className="text-xs font-medium">{c.label}</p>
                      <div className="grid gap-1 md:grid-cols-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Before</p>
                          <pre className="whitespace-pre-wrap break-all rounded border border-border bg-[hsl(0_84%_60%/0.08)] p-2 text-xs font-mono">{c.prev ?? '—'}</pre>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">After</p>
                          <pre className="whitespace-pre-wrap break-all rounded border border-border bg-[hsl(142_71%_45%/0.08)] p-2 text-xs font-mono">{c.curr ?? '—'}</pre>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

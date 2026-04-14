'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { resolveFix, resolveBlacklistFix, type FixCopy, type BlacklistFixCopy } from '@/lib/fixes';
import { cn } from '@/lib/utils';

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded border border-border bg-muted/50 p-2 text-xs font-mono">{text}</pre>
      <Button size="sm" variant="outline" onClick={copy} className="shrink-0">{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );
}

function FixBody({ fix }: { fix: FixCopy }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{fix.explanation}</p>
      {fix.suggested && fix.suggested.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested DNS</p>
          {fix.suggested.map((rec, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs">
                <span className="font-mono">{rec.host}</span> <span className="text-muted-foreground">({rec.type})</span>
              </p>
              <CopyBlock text={rec.value} />
            </div>
          ))}
        </div>
      )}
      {fix.verify && fix.verify.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verify</p>
          {fix.verify.map((cmd, i) => <CopyBlock key={i} text={cmd} />)}
        </div>
      )}
      {fix.links && fix.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fix.links.map((l, i) => (
            <a key={i} href={l.href} target="_blank" rel="noreferrer" className="text-xs underline">{l.label} →</a>
          ))}
        </div>
      )}
    </div>
  );
}

export function FixThis({ issue, domain, className }: { issue: string; domain: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const fix = resolveFix(issue, domain);
  return (
    <div className={cn('rounded-md border border-border p-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">{issue}</p>
        {fix && (
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Fix this →'}
          </Button>
        )}
      </div>
      {open && fix && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 font-medium">{fix.title}</p>
          <FixBody fix={fix} />
        </div>
      )}
    </div>
  );
}

export function BlacklistFixThis({ name, ip, removalUrl, className }: {
  name: string;
  ip: string;
  removalUrl?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const fix: BlacklistFixCopy = resolveBlacklistFix(name, ip);
  const url = removalUrl ?? fix.removalUrl;
  return (
    <div className={cn('rounded-md border border-border p-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm"><strong>{name}</strong> — {ip}</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Fix this →'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          <p className="font-medium">{fix.title}</p>
          <p className="text-muted-foreground">{fix.explanation}</p>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Steps</p>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              {fix.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-block text-xs underline">
              Open delisting form →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

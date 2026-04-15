'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';

function CopyField({ label, value }: { label?: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (await copyToClipboard(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>}
      <div className="flex items-start gap-2">
        <pre className="flex-1 overflow-x-auto rounded border border-border bg-muted/50 p-2 text-xs font-mono">{value}</pre>
        <Button size="sm" variant="outline" onClick={copy} className="shrink-0">{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
}

export interface SmtpConfig {
  hostname: string;
  port: number;
  listenerAddress: string;
  suggestedLocalPart: string;
}

/**
 * Shows the DNS records and MX routing needed so DMARC aggregate reports
 * flow into the MxWatch SMTP listener. Use `domain` to render a concrete
 * example; leave undefined to show placeholders.
 */
export function DmarcSetup({ smtp, domain }: { smtp: SmtpConfig; domain?: string }) {
  const d = domain ?? 'yourdomain.com';
  const rua = `v=DMARC1; p=none; rua=mailto:${smtp.suggestedLocalPart}@${smtp.hostname}; fo=1`;
  const mxTarget = smtp.hostname;
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium">1. Publish a DMARC record</h3>
        <p className="text-muted-foreground">
          Add a TXT record at <code>_dmarc.{d}</code> so reporting providers (Google, Yahoo, Microsoft)
          know to send aggregate reports to MxWatch.
        </p>
        <CopyField label={`_dmarc.${d} — TXT`} value={rua} />
        <p className="text-xs text-muted-foreground">
          Start at <code>p=none</code> to monitor without impacting delivery. Step up to <code>p=quarantine</code>
          then <code>p=reject</code> once reports look clean.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">2. Route reports to the SMTP listener</h3>
        <p className="text-muted-foreground">
          MxWatch accepts DMARC aggregate XML on <code>{smtp.listenerAddress}</code>. There are two ways to get
          messages there:
        </p>
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">Option A — Point MX at MxWatch (recommended)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add an MX record for the reporting subdomain so all mail to
              <code> {smtp.suggestedLocalPart}@{smtp.hostname}</code> lands on this server.
            </p>
            <div className="mt-2">
              <CopyField label={`${smtp.hostname} — MX (priority 10)`} value={mxTarget} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Port {smtp.port} is used — receiving providers try port 25 first; if MxWatch runs on 2525 you'll
              need a relay (e.g. Stalwart / Postfix) on 25 that forwards to {smtp.port}.
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">Option B — Forward from an existing mailbox</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Keep <code>rua=mailto:dmarc@{d}</code> in your DMARC record and configure your mail server to
              forward that mailbox to <code>{smtp.suggestedLocalPart}@{smtp.hostname}</code> (or pipe the raw
              message to <code>{smtp.listenerAddress}</code> via SMTP).
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">3. Verify</h3>
        <CopyField label="Verify the DMARC record" value={`dig +short TXT _dmarc.${d}`} />
        <p className="text-xs text-muted-foreground">
          Aggregate reports arrive 24–48 hours after the first mail goes out under the new policy. The DMARC tab
          on the domain page will populate once the first report lands.
        </p>
      </section>
    </div>
  );
}

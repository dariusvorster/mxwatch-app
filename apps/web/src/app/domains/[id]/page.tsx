'use client';
import { use, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HealthScoreBadge } from '@/components/health-score-badge';
import { DmarcTimelineChart } from '@/components/dmarc-timeline-chart';
import { DnsHistoryList } from '@/components/dns-diff';
import { FixThis, BlacklistFixThis } from '@/components/fix-this';
import { PostmasterCard } from '@/components/postmaster-card';
import { DnsPropagationCard } from '@/components/dns-propagation-card';
import { IpReputationCard } from '@/components/ip-reputation-card';
import { copyToClipboard } from '@/lib/clipboard';
import { DomainTopologyCard } from '@/components/domain-topology-card';
import { DomainHeader } from '@/components/domain-header';
import { PillTabs, PillTabsList, PillTabsTrigger, PillTabsContent, PillTabsActiveStyle } from '@/components/pill-tabs';
import { DomainOverview } from '@/components/domain-overview';
import { DomainLogsTab } from '@/components/domain-logs-tab';
import { DomainIntegrationsWidget } from '@/components/domain-integrations-widget';
import { DelistWizard } from '@/components/delist-wizard';
import { rblKeyForDisplayName } from '@/lib/rbl-display-names';
import { useState } from 'react';

export default function DomainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const domain = trpc.domains.get.useQuery({ id });
  const latest = trpc.checks.latestDns.useQuery({ domainId: id });
  const blacklistRows = trpc.checks.latestBlacklist.useQuery({ domainId: id });
  const reports = trpc.reports.list.useQuery({ domainId: id, limit: 50 });
  const summary = trpc.reports.summary.useQuery({ domainId: id, days: 30 });
  const live = trpc.checks.liveHealth.useQuery({ domainId: id });
  const router = useRouter();
  const remove = trpc.domains.remove.useMutation({ onSuccess: () => router.push('/') });
  const runDns = trpc.checks.runDns.useMutation({
    onSuccess: () => { latest.refetch(); },
  });
  const runBlacklist = trpc.checks.runBlacklist.useMutation({
    onSuccess: () => { blacklistRows.refetch(); },
  });
  const [ipToCheck, setIpToCheck] = useState('');

  if (domain.isLoading) return <main className="p-6">Loading…</main>;
  if (!domain.data) return <main className="p-6">Not found</main>;

  const snap = latest.data;

  const mxList = snap?.mxRecords ? (JSON.parse(snap.mxRecords) as string[]) : [];
  const mailServer = mxList[0] ?? null;
  const authOk = !!snap?.spfValid && !!snap?.dkimValid && !!snap?.dmarcValid;
  const authAny = !!snap?.spfValid || !!snap?.dkimValid || !!snap?.dmarcValid;
  const authTone: 'healthy' | 'warning' | 'critical' | 'neutral' =
    !snap ? 'neutral' : authOk ? 'healthy' : authAny ? 'warning' : 'critical';
  const authLabel = !snap ? 'auth pending'
    : authOk ? 'SPF · DKIM · DMARC pass'
    : `${[snap.spfValid && 'SPF', snap.dkimValid && 'DKIM', snap.dmarcValid && 'DMARC'].filter(Boolean).join(' · ') || 'auth failing'}`;
  const latestBl = blacklistRows.data?.[0];
  const listedCount = latestBl?.isListed ? (JSON.parse(latestBl.listedOn ?? '[]') as string[]).length : 0;
  const rblTone: 'healthy' | 'warning' | 'critical' | 'neutral' =
    !latestBl ? 'neutral' : listedCount > 0 ? 'critical' : 'healthy';
  const rblLabel = !latestBl ? 'RBL not checked' : listedCount > 0 ? `RBL: ${listedCount} listed` : 'RBL: all clean';

  return (
    <>
      <PillTabsActiveStyle />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <DomainHeader
          domain={domain.data.domain}
          score={snap?.healthScore ?? null}
          mailServer={mailServer}
          sendingIp={domain.data.sendingIp ?? null}
          authTone={authTone}
          authLabel={authLabel}
          rblTone={rblTone}
          rblLabel={rblLabel}
          onRunChecks={() => { runDns.mutate({ domainId: id }); live.refetch(); }}
          runChecksPending={runDns.isPending}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Remove ${domain.data?.domain}? All snapshots, reports, and alerts for this domain will be deleted.`)) {
                remove.mutate({ id });
              }
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove domain'}
          </Button>
        </div>

      <PillTabs defaultValue="overview">
        <PillTabsList>
          <PillTabsTrigger value="overview" className="pt-trigger">Overview</PillTabsTrigger>
          <PillTabsTrigger value="dmarc" className="pt-trigger">DMARC</PillTabsTrigger>
          <PillTabsTrigger value="dns" className="pt-trigger">DNS records</PillTabsTrigger>
          <PillTabsTrigger value="blacklists" className="pt-trigger">Blacklists</PillTabsTrigger>
          <PillTabsTrigger value="smtp" className="pt-trigger">SMTP</PillTabsTrigger>
          <PillTabsTrigger value="alerts" className="pt-trigger">Alerts</PillTabsTrigger>
          <PillTabsTrigger value="mail-log" className="pt-trigger">Mail log</PillTabsTrigger>
          <PillTabsTrigger value="postmaster" className="pt-trigger">Postmaster</PillTabsTrigger>
          <PillTabsTrigger value="history" className="pt-trigger">History</PillTabsTrigger>
          <PillTabsTrigger value="logs" className="pt-trigger">Logs</PillTabsTrigger>
        </PillTabsList>

        <PillTabsContent value="overview">
          <div className="space-y-4">
            <DomainOverview domainId={id} />
            <DomainIntegrationsWidget domainId={id} />
            <DkimSelectorsCard domainId={id} live={live.data} />
            {live.data && (
              <IssuesCard domain={domain.data.domain} health={live.data} />
            )}
          </div>
        </PillTabsContent>

        <PillTabsContent value="dmarc" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/v1/domains/${id}/reports?days=30&limit=500&format=csv`} download>
                Export CSV
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/v1/domains/${id}/reports.pdf?days=30`} download>
                Export PDF
              </a>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryStat label="Reports" value={summary.data?.totalReports ?? 0} />
            <SummaryStat label="Messages" value={summary.data?.totalMessages ?? 0} />
            <SummaryStat
              label="Pass rate"
              value={summary.data?.passRate != null ? `${(summary.data.passRate * 100).toFixed(1)}%` : '—'}
            />
            <SummaryStat label="Fail" value={summary.data?.totalFail ?? 0} />
          </div>

          <Card>
            <CardHeader><CardTitle>Pass / fail timeline (last 30 days)</CardTitle></CardHeader>
            <CardContent>
              {summary.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <DmarcTimelineChart data={summary.data?.timeline ?? []} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Source IP breakdown</CardTitle></CardHeader>
            <CardContent>
              {summary.data && summary.data.sourceIps.length > 0 ? (
                <div className="overflow-x-auto">
                  <SourceIpTable domainId={id} rows={summary.data.sourceIps} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    <strong>Yours</strong> = we have outbound events from this IP in the Mail log. <strong>Unverified</strong> = no local log trace — could be a legitimate relay we don't log, or a spoof.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No source IP data yet.</p>
              )}
            </CardContent>
          </Card>

          <UnexpectedSendersCard domainId={id} />

          <Card>
            <CardHeader><CardTitle>Recent reports</CardTitle></CardHeader>
            <CardContent>
              {reports.data && reports.data.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2">Reporter</th>
                      <th>Received</th>
                      <th>Messages</th>
                      <th>Pass/Fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.data.map((r) => (
                      <tr key={r.id} className="border-b border-border">
                        <td className="py-2">
                          <Link href={`/domains/${id}/reports/${r.id}`} className="underline">{r.orgName}</Link>
                        </td>
                        <td>{new Date(r.receivedAt).toLocaleString()}</td>
                        <td>{r.totalMessages ?? 0}</td>
                        <td>{r.passCount ?? 0} / {r.failCount ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No reports yet. Add <code>rua=mailto:dmarc@yourdomain</code> to your DMARC record pointing at the MxWatch SMTP listener (port 2525).
                </p>
              )}
            </CardContent>
          </Card>
        </PillTabsContent>

        <PillTabsContent value="blacklists" className="space-y-4">
          <IpReputationCard domainId={id} />
          <Card>
            <CardHeader>
              <CardTitle>Blacklist checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (ipToCheck) runBlacklist.mutate({ domainId: id, ip: ipToCheck });
                }}
              >
                <input
                  value={ipToCheck}
                  onChange={(e) => setIpToCheck(e.target.value)}
                  placeholder="Sending IP (IPv4)"
                  className="flex h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                />
                <Button type="submit" disabled={runBlacklist.isPending}>Check</Button>
              </form>
              <div className="space-y-3">
                {blacklistRows.data?.map((r) => {
                  const listed = (JSON.parse(r.listedOn ?? '[]') as string[]);
                  return (
                    <div key={r.id} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{r.ipAddress} @ {new Date(r.checkedAt).toLocaleString()}</span>
                        {r.isListed ? <Badge variant="destructive">Listed</Badge> : <Badge variant="success">Clean</Badge>}
                      </div>
                      {r.isListed && listed.map((name) => {
                        const key = rblKeyForDisplayName(name);
                        return (
                          <div key={name} className="space-y-2">
                            <BlacklistFixThis name={name} ip={r.ipAddress ?? ''} />
                            {key && (
                              <DelistWizard
                                domainId={id}
                                rblName={key}
                                listedValue={r.ipAddress ?? ''}
                                listingType="ip"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </PillTabsContent>

        <PillTabsContent value="dns" className="space-y-4">
          <div className="flex justify-end">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/v1/domains/${id}/dns?limit=500&format=csv`} download>
                Export CSV
              </a>
            </Button>
          </div>
          <Card>
            <CardHeader><CardTitle>Current DNS records</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="SPF" value={snap?.spfRecord} />
              <Field label="DKIM selector" value={snap?.dkimSelector} />
              <Field label="DKIM record" value={snap?.dkimRecord} />
              <Field label="DMARC" value={snap?.dmarcRecord} />
              <Field label="MX" value={snap?.mxRecords ? (JSON.parse(snap.mxRecords) as string[]).join(', ') : null} />
            </CardContent>
          </Card>

          <DnsPropagationCard domainId={id} domain={domain.data.domain} />
          <DnsHistoryCard domainId={id} />
        </PillTabsContent>

        <PillTabsContent value="alerts">
          <AlertRulesCard domainId={id} />
        </PillTabsContent>

        <PillTabsContent value="mail-log" className="space-y-4">
          <MailLogTokensCard domainId={id} />
          <MailLogEventsCard domainId={id} />
        </PillTabsContent>

        <PillTabsContent value="postmaster">
          <div className="space-y-4">
            <PostmasterCard domainId={id} />
          </div>
        </PillTabsContent>

        <PillTabsContent value="smtp">
          <div className="space-y-4">
            <DomainTopologyCard domain={domain.data} />
            <Card>
              <CardHeader><CardTitle>Inbound SMTP listener</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                MxWatch accepts DMARC aggregate reports on the local SMTP listener. Configure the <code>rua=mailto:</code>
                target and MX routing from <Link href="/settings/smtp" className="underline">Settings → SMTP ingest</Link>.
              </CardContent>
            </Card>
          </div>
        </PillTabsContent>

        <PillTabsContent value="history">
          <div className="space-y-4">
            <DnsHistoryCard domainId={id} />
          </div>
        </PillTabsContent>

        <PillTabsContent value="logs">
          <DomainLogsTab domainId={id} />
        </PillTabsContent>
      </PillTabs>
      </div>
    </>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground break-all">{detail}</p>
      </div>
      <Badge variant={ok ? 'success' : 'destructive'}>{ok ? 'OK' : 'Issue'}</Badge>
    </div>
  );
}

import { humanizeAlertType } from '@/lib/alert-display';

const RULE_DESCRIPTIONS: Record<string, string> = {
  blacklist_listed: 'Fires the moment any monitored RBL lists a checked IP. Auto-resolves when clean.',
  dns_record_changed: 'Fires when SPF, DKIM, or DMARC TXT records differ from the previous snapshot.',
  health_score_drop: 'Fires when the health score drops by at least the threshold (default 20 points).',
  dmarc_report_received: 'Fires on every new DMARC aggregate report ingested for this domain.',
  dmarc_fail_spike: 'Fires when the DMARC fail rate over the last 24h exceeds the threshold. Auto-resolves when it drops.',
};

const THRESHOLD_UNIT: Record<string, string> = {
  health_score_drop: 'points',
  dmarc_fail_spike: '%',
};

type SourceIpRow = {
  sourceIp: string;
  total: number;
  spfPass: number;
  dkimPass: number;
  quarantine: number;
  reject: number;
  localEvents: number;
  localOutbound: number;
  recognised: boolean;
};

function SourceIpTable({ domainId, rows }: { domainId: string; rows: SourceIpRow[] }) {
  const [openIp, setOpenIp] = useState<string | null>(null);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-2">Source IP</th>
          <th className="py-2">Origin</th>
          <th className="py-2 text-right">Messages</th>
          <th className="py-2 text-right">SPF pass</th>
          <th className="py-2 text-right">DKIM pass</th>
          <th className="py-2 text-right">Local log</th>
          <th className="py-2 text-right">Quarantined</th>
          <th className="py-2 text-right">Rejected</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = openIp === r.sourceIp;
          const canDrill = r.localEvents > 0;
          return (
            <Fragment key={r.sourceIp}>
              <tr className="border-b border-border">
                <td className="py-2 font-mono text-xs">{r.sourceIp}</td>
                <td className="py-2">
                  {r.recognised
                    ? <Badge variant="success">Yours</Badge>
                    : r.localEvents > 0
                      ? <Badge variant="outline">Seen inbound</Badge>
                      : <Badge variant="warning">Unverified</Badge>}
                </td>
                <td className="py-2 text-right">{r.total}</td>
                <td className="py-2 text-right">{r.spfPass}</td>
                <td className="py-2 text-right">{r.dkimPass}</td>
                <td className="py-2 text-right">{r.localOutbound}{r.localEvents !== r.localOutbound ? ` / ${r.localEvents}` : ''}</td>
                <td className="py-2 text-right">{r.quarantine}</td>
                <td className="py-2 text-right">{r.reject}</td>
                <td className="py-2 text-right">
                  {canDrill && (
                    <Button size="sm" variant="outline" onClick={() => setOpenIp(isOpen ? null : r.sourceIp)}>
                      {isOpen ? 'Hide' : 'Log'}
                    </Button>
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={9} className="p-0">
                    <div className="border-b border-border bg-muted/30 p-3">
                      <MailEventsForIp domainId={domainId} ip={r.sourceIp} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function MailEventsForIp({ domainId, ip }: { domainId: string; ip: string }) {
  const events = trpc.mailLog.eventsByIp.useQuery({ domainId, ip, days: 30, limit: 100 });
  if (events.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!events.data || events.data.length === 0) {
    return <p className="text-xs text-muted-foreground">No mail-log events from {ip} in the last 30 days.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-muted-foreground">
        {events.data.length} event{events.data.length > 1 ? 's' : ''} from <span className="font-mono">{ip}</span> — last 30 days.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-1">Time</th>
            <th className="py-1">Direction</th>
            <th className="py-1">Event</th>
            <th className="py-1">From</th>
            <th className="py-1">To</th>
            <th className="py-1">Result</th>
          </tr>
        </thead>
        <tbody>
          {events.data.map((e) => (
            <tr key={e.id} className="border-b border-border/60">
              <td className="py-1">{new Date(e.eventTime ?? e.receivedAt).toLocaleString()}</td>
              <td className="py-1"><Badge variant="outline">{e.direction}</Badge></td>
              <td className="py-1 font-mono">{e.eventType ?? '—'}</td>
              <td className="py-1 font-mono truncate max-w-[160px]">{e.senderAddress ?? '—'}</td>
              <td className="py-1 font-mono truncate max-w-[160px]">{e.recipientAddress ?? '—'}</td>
              <td className="py-1">
                {e.resultCode ? <span className="font-mono">{e.resultCode}</span> : null}
                {e.resultMessage ? <span className="ml-1 text-muted-foreground">{e.resultMessage}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SendingIpCard({ domainId, currentIp }: { domainId: string; currentIp: string | null }) {
  const [value, setValue] = useState(currentIp ?? '');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const suggestions = trpc.domains.suggestSendingIp.useQuery({ domainId });
  const setIp = trpc.domains.setSendingIp.useMutation({
    onSuccess: () => { utils.domains.get.invalidate({ id: domainId }); setError(null); },
    onError: (e) => setError(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending IP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Set the IPv4 address that sends outbound mail for this domain. MxWatch checks it against all 12 RBLs every 6 hours.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); setIp.mutate({ id: domainId, ip: value.trim() }); }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 185.199.108.153"
            className="flex h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm font-mono"
          />
          <Button type="submit" disabled={setIp.isPending}>Save</Button>
          {currentIp && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setValue(''); setIp.mutate({ id: domainId, ip: '' }); }}
              disabled={setIp.isPending}
            >
              Clear
            </Button>
          )}
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {suggestions.data && suggestions.data.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">From your mail log (last 7d)</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {suggestions.data.map((s) => (
                <Button
                  key={s.ip}
                  size="sm"
                  variant="outline"
                  onClick={() => { setValue(s.ip); setIp.mutate({ id: domainId, ip: s.ip }); }}
                  disabled={setIp.isPending}
                >
                  <span className="font-mono">{s.ip}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{s.count}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        {!currentIp && (!suggestions.data || suggestions.data.length === 0) && (
          <p className="text-xs text-muted-foreground">
            No sending IP set — scheduled blacklist checks are skipped for this domain. Send some mail through a connected Stalwart, or paste your IP above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MailLogTokensCard({ domainId }: { domainId: string }) {
  const tokens = trpc.mailLog.listTokens.useQuery({ domainId });
  const create = trpc.mailLog.createToken.useMutation({ onSuccess: () => tokens.refetch() });
  const revoke = trpc.mailLog.revokeToken.useMutation({ onSuccess: () => tokens.refetch() });
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createOne(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const label = (fd.get('label') as string) || undefined;
    const res = await create.mutateAsync({ domainId, label });
    setNewPlaintext(res.plaintext);
    form.reset();
  }

  async function copyToken() {
    if (!newPlaintext) return;
    if (await copyToClipboard(newPlaintext)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const curlExample = newPlaintext
    ? `curl -X POST ${appUrl}/api/logs/ingest \\
  -H "Authorization: Bearer ${newPlaintext}" \\
  -H "Content-Type: application/x-ndjson" \\
  --data-binary @stalwart.jsonl`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={createOne} className="flex gap-2">
          <input
            name="label"
            placeholder="Label (e.g. stalwart-prod)"
            className="flex h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button type="submit" disabled={create.isPending}>Create token</Button>
        </form>

        {newPlaintext && (
          <div className="rounded-md border border-border bg-[hsl(142_71%_45%/0.08)] p-3 space-y-2">
            <p className="text-sm font-medium">Copy this token now — it won't be shown again.</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded border border-border bg-background p-2 text-xs font-mono">{newPlaintext}</pre>
              <Button size="sm" variant="outline" onClick={copyToken}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            {curlExample && (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Example usage</p>
                <pre className="overflow-x-auto rounded border border-border bg-background p-2 text-xs font-mono">{curlExample}</pre>
              </>
            )}
          </div>
        )}

        {tokens.data && tokens.data.length > 0 ? (
          <div className="divide-y divide-border">
            {tokens.data.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2">
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
          <p className="text-sm text-muted-foreground">No tokens yet. Create one above to start pushing logs.</p>
        )}
      </CardContent>
    </Card>
  );
}

function MailLogEventsCard({ domainId }: { domainId: string }) {
  const events = trpc.mailLog.listEvents.useQuery({ domainId, limit: 100 });
  return (
    <Card>
      <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
      <CardContent>
        {events.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.data && events.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2">Time</th>
                  <th className="py-2">Direction</th>
                  <th className="py-2">From</th>
                  <th className="py-2">To</th>
                  <th className="py-2">Remote IP</th>
                  <th className="py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="py-2 text-xs">{new Date(e.eventTime ?? e.receivedAt).toLocaleString()}</td>
                    <td className="py-2"><Badge variant="outline">{e.direction}</Badge></td>
                    <td className="py-2 font-mono text-xs truncate max-w-[180px]">{e.senderAddress ?? '—'}</td>
                    <td className="py-2 font-mono text-xs truncate max-w-[180px]">{e.recipientAddress ?? '—'}</td>
                    <td className="py-2 font-mono text-xs">{e.remoteIp ?? '—'}</td>
                    <td className="py-2 text-xs">
                      {e.resultCode ? <span className="font-mono">{e.resultCode}</span> : null}
                      {e.resultMessage ? <span className="ml-1 text-muted-foreground">{e.resultMessage}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No events yet. POST Stalwart JSON logs to <code>/api/logs/ingest</code> with a bearer token created above.</p>
        )}
      </CardContent>
    </Card>
  );
}

function UnexpectedSendersCard({ domainId }: { domainId: string }) {
  const q = trpc.reports.unexpectedSenders.useQuery({ domainId, days: 30 });
  const rows = q.data?.rows ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Unexpected senders (30d)</span>
          <Badge variant={rows.length > 0 ? 'destructive' : 'success'}>{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !q.data?.spfRecord ? (
          <p className="text-sm text-muted-foreground">
            No SPF record on file — every reported sender will look unexpected. Publish an SPF record to populate this panel.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All source IPs in recent DMARC reports are covered by your SPF <code>ip4:</code> / <code>ip6:</code> mechanisms.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              IPs that sent mail as this domain but aren't in your SPF record. <code>include:</code> mechanisms aren't resolved transitively — manually verify each source before adding to SPF.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2">Source IP</th>
                    <th className="py-2 text-right">Messages</th>
                    <th className="py-2 text-right">SPF pass</th>
                    <th className="py-2 text-right">DKIM pass</th>
                    <th className="py-2 text-right">Quarantine</th>
                    <th className="py-2 text-right">Reject</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r) => (
                    <tr key={r.sourceIp} className="border-b border-border">
                      <td className="py-2 font-mono text-xs">{r.sourceIp}</td>
                      <td className="py-2 text-right">{r.volume}</td>
                      <td className="py-2 text-right">{r.spfPass}</td>
                      <td className="py-2 text-right">{r.dkimPass}</td>
                      <td className="py-2 text-right">{r.quarantine}</td>
                      <td className="py-2 text-right">{r.reject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DnsHistoryCard({ domainId }: { domainId: string }) {
  const history = trpc.checks.snapshotHistory.useQuery({ domainId, limit: 50 });
  return (
    <Card>
      <CardHeader><CardTitle>Change history</CardTitle></CardHeader>
      <CardContent>
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <DnsHistoryList snapshots={(history.data ?? []) as any} />
        )}
      </CardContent>
    </Card>
  );
}

function DkimSelectorsCard({ domainId, live }: { domainId: string; live?: LiveHealth }) {
  const selectors = trpc.domains.selectors.useQuery({ domainId });
  const add = trpc.domains.addSelector.useMutation({ onSuccess: () => selectors.refetch() });
  const remove = trpc.domains.removeSelector.useMutation({ onSuccess: () => selectors.refetch() });
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const selector = String(fd.get('selector') ?? '').trim();
    if (!selector) return;
    try {
      await add.mutateAsync({ domainId, selector });
      e.currentTarget.reset();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add selector');
    }
  }

  const liveBySelector = new Map((live?.dkim ?? []).map((d) => [d.selector, d]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>DKIM selectors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectors.data && selectors.data.length > 0 ? (
          <div className="divide-y divide-border">
            {selectors.data.map((s) => {
              const result = liveBySelector.get(s.selector);
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm">{s.selector}._domainkey</p>
                    {result?.issues && result.issues.length > 0 && (
                      <p className="text-xs text-destructive">{result.issues[0]}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {result ? (
                      result.valid
                        ? <Badge variant="success">OK</Badge>
                        : <Badge variant="destructive">{result.record ? 'Issue' : 'Missing'}</Badge>
                    ) : (
                      <Badge variant="outline">—</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Remove selector "${s.selector}"?`)) remove.mutate({ id: s.id });
                      }}
                      disabled={remove.isPending}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No selectors yet.</p>
        )}

        <form onSubmit={onAdd} className="flex gap-2">
          <input
            name="selector"
            placeholder="selector (e.g. mail, dkim2026)"
            className="flex h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button type="submit" disabled={add.isPending}>Add</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          MxWatch checks <code>{'<selector>'}._domainkey.&lt;domain&gt;</code> for each one on every DNS sweep.
        </p>
      </CardContent>
    </Card>
  );
}

function AlertRulesCard({ domainId }: { domainId: string }) {
  const rules = trpc.alerts.listRules.useQuery({ domainId });
  const upsert = trpc.alerts.upsertRule.useMutation({ onSuccess: () => rules.refetch() });
  return (
    <Card>
      <CardHeader><CardTitle>Alert rules</CardTitle></CardHeader>
      <CardContent>
        {rules.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rules.data && rules.data.length > 0 ? (
          <div className="divide-y divide-border">
            {rules.data.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{humanizeAlertType(r.type)}</p>
                    <p className="text-xs text-muted-foreground">{RULE_DESCRIPTIONS[r.type] ?? ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Paused</Badge>}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => upsert.mutate({
                        id: r.id,
                        domainId,
                        type: r.type,
                        threshold: r.threshold ?? null,
                        isActive: !r.isActive,
                      })}
                      disabled={upsert.isPending}
                    >
                      {r.isActive ? 'Pause' : 'Resume'}
                    </Button>
                  </div>
                </div>
                {THRESHOLD_UNIT[r.type] && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Threshold:</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={r.threshold ?? (r.type === 'dmarc_fail_spike' ? 10 : 20)}
                      onBlur={(e) => {
                        const v = parseInt(e.currentTarget.value, 10);
                        if (!Number.isFinite(v) || v === r.threshold) return;
                        upsert.mutate({
                          id: r.id,
                          domainId,
                          type: r.type,
                          threshold: v,
                          isActive: r.isActive ?? true,
                        });
                      }}
                      className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">{THRESHOLD_UNIT[r.type]}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No rules yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

import type { DomainHealth } from '@mxwatch/types';
type LiveHealth = DomainHealth;

function IssuesCard({ domain, health }: { domain: string; health: LiveHealth }) {
  const issues: string[] = [
    ...health.spf.issues,
    ...health.dkim.flatMap((d) => d.issues),
    ...health.dmarc.issues,
  ];
  if (issues.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Issues</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No issues detected. Nice.</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Issues ({issues.length})</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {issues.map((issue, i) => (
          <FixThis key={i} issue={issue} domain={domain} />
        ))}
      </CardContent>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="mt-1 whitespace-pre-wrap break-all rounded border border-border bg-muted/50 p-2 text-xs">{value || '—'}</pre>
    </div>
  );
}

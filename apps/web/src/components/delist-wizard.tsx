'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

type TimelineEvent = { ts: string; event: string; detail?: string };

const STATUS_TONE: Record<string, 'healthy' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  not_submitted: 'neutral',
  submitted: 'info',
  pending: 'warning',
  cleared: 'healthy',
  rejected: 'critical',
  expired: 'neutral',
};

export function DelistWizard({
  domainId, rblName, listedValue, listingType,
}: {
  domainId: string;
  rblName: string; // short name from RBL_KNOWLEDGE (e.g. 'spamhaus-zen')
  listedValue: string;
  listingType: 'ip' | 'domain';
}) {
  const info = trpc.delist.getRBLInfo.useQuery({ rblName });
  const getOrCreate = trpc.delist.getOrCreate.useMutation();
  const markSubmitted = trpc.delist.markSubmitted.useMutation();
  const checkNow = trpc.delist.checkNow.useMutation();

  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<any>(null);
  const [note, setNote] = useState('');

  const rbl = info.data;

  async function start() {
    setOpen(true);
    if (!request) {
      const r = await getOrCreate.mutateAsync({ domainId, rblName, listedValue, listingType });
      setRequest(r);
    }
  }

  async function submit(method: 'form' | 'email' | 'manual_confirmed') {
    if (!request) return;
    await markSubmitted.mutateAsync({ requestId: request.id, method, note });
    setRequest({ ...request, status: 'pending', submissionMethod: method, submittedAt: new Date() });
  }

  async function recheck() {
    if (!request) return;
    const updated = await checkNow.mutateAsync({ requestId: request.id });
    setRequest(updated);
  }

  if (!rbl) {
    return (
      <div style={panel}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          No knowledge-base entry for <b>{rblName}</b> yet — delist this manually.
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={start}>
        Get help delisting
      </Button>
    );
  }

  const status = (request?.status as string | undefined) ?? 'not_submitted';
  const timeline: TimelineEvent[] = request?.timeline ? safeParseTimeline(request.timeline) : [];

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600 }}>{rbl.name}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            listing: <span style={{ color: 'var(--text)' }}>{listedValue}</span> · type: {rbl.type}
          </div>
        </div>
        <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</StatusBadge>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{rbl.severityNote}</p>

      {status === 'not_submitted' && (
        <>
          <Section title="Why listings happen">
            <ul style={list}>
              {rbl.listingReasons.map((r: string) => <li key={r}>{r}</li>)}
            </ul>
          </Section>

          <Section title={`Clear time: ${rbl.typicalClearTime}`}>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}>
              {rbl.autoExpires
                ? `Auto-expires in ${rbl.autoExpireHours}h if no more hits — MxWatch will poll and mark cleared.`
                : `This RBL requires a ${labelForMethod(rbl.delistMethod)} to clear the listing.`}
            </p>
          </Section>

          {rbl.requiresExplanation && (
            <Section title="Optional note to save on the request">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                style={{
                  width: '100%', fontFamily: 'var(--mono)', fontSize: 11,
                  padding: 8, background: 'var(--bg)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                }}
                placeholder="Context for your future self — e.g. reason you believe the listing is stale."
              />
            </Section>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {rbl.delistMethod === 'email_request' && rbl.delistEmail && (
              <>
                <a href={`mailto:${rbl.delistEmail}?subject=Delist request: ${listedValue}`}
                  target="_blank" rel="noreferrer">
                  <Button size="sm">Open email client</Button>
                </a>
                <Button size="sm" variant="outline" onClick={() => submit('email')}>I've sent the email</Button>
              </>
            )}
            {rbl.delistUrl && (
              <>
                <a href={rbl.delistUrl} target="_blank" rel="noreferrer">
                  <Button size="sm">Open delist form</Button>
                </a>
                <Button size="sm" variant="outline" onClick={() => submit('form')}>I've submitted</Button>
              </>
            )}
            {rbl.autoExpires && (
              <Button size="sm" onClick={() => submit('manual_confirmed')}>
                Start auto-expire tracking
              </Button>
            )}
          </div>

          <Section title="How to avoid this next time">
            <ul style={list}>
              {rbl.preventionTips.map((t: string) => <li key={t}>{t}</li>)}
            </ul>
          </Section>
        </>
      )}

      {(status === 'submitted' || status === 'pending') && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text2)' }}>
            MxWatch is polling this RBL hourly and will mark it cleared when the listing disappears.
          </p>
          {request?.lastPolledAt && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
              Last poll: {relativeTime(new Date(request.lastPolledAt))}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={recheck} disabled={checkNow.isPending}>
            {checkNow.isPending ? 'Checking…' : 'Check now'}
          </Button>
        </>
      )}

      {status === 'cleared' && (
        <p style={{ fontSize: 12, color: 'var(--green)' }}>
          ✓ Cleared
          {request?.clearedAt && <> · {relativeTime(new Date(request.clearedAt))}</>}
        </p>
      )}

      {status === 'expired' && (
        <p style={{ fontSize: 12, color: 'var(--amber)' }}>
          Auto-expire window passed but the listing persists. The RBL may have re-scored — start a new delist.
        </p>
      )}

      {timeline.length > 0 && (
        <Section title="Timeline">
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            {timeline.map((e, i) => (
              <div key={i} style={{ padding: '3px 0' }}>
                <span style={{ color: 'var(--text2)' }}>{new Date(e.ts).toISOString().slice(0, 16).replace('T', ' ')}</span>
                {' '}· <span style={{ color: 'var(--text)' }}>{e.event}</span>
                {e.detail && <> — {e.detail}</>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
      }}>{title}</div>
      {children}
    </div>
  );
}

function labelForMethod(m: string): string {
  switch (m) {
    case 'self_service_form': return 'self-service form';
    case 'email_request': return 'manual email request';
    case 'portal_registration': return 'portal registration + request';
    case 'reputation_based': return 'reputation recovery over time';
    case 'manual_review': return 'manual review by the RBL maintainer';
    default: return m;
  }
}

function safeParseTimeline(v: string): TimelineEvent[] {
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const panel: React.CSSProperties = {
  padding: 12,
  background: 'var(--surf2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const list: React.CSSProperties = {
  margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--text2)', lineHeight: 1.5,
};

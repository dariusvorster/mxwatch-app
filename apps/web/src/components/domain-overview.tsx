'use client';
import * as React from 'react';
import { trpc } from '@/lib/trpc';
import { StatusBadge } from '@/components/status-badge';
import { IconShield } from '@/components/icons';
import { BLACKLISTS_META } from '@/lib/rbl-meta';
import { relativeTime } from '@/lib/alert-display';

interface LiveDkim { selector: string; valid: boolean; record: string | null; issues: string[] }
interface LiveSpf  { valid: boolean; record: string | null; lookupCount: number; issues: string[] }
interface LiveDmarc { valid: boolean; record: string | null; policy: 'none' | 'quarantine' | 'reject' | null; hasRua: boolean; issues: string[] }

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHead({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)',
        }}
      >
        {title}
      </div>
      {badge}
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'green' | 'amber' | 'red' | 'text3' }) {
  const color = tone === 'green' ? 'var(--green)'
    : tone === 'amber' ? 'var(--amber)'
    : tone === 'red' ? 'var(--red)'
    : tone === 'text3' ? 'var(--text3)'
    : 'var(--text)';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0' }}>
      <div style={{ width: 88, fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)' }}>{k}</div>
      <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11, color, wordBreak: 'break-all' }}>
        {v}
      </div>
    </div>
  );
}

function SpfCard({ r }: { r: LiveSpf | undefined }) {
  const loaded = !!r;
  const valid = !!r?.valid;
  const tone = !loaded ? 'neutral' : valid ? 'healthy' : 'critical';
  const label = !loaded ? 'pending' : valid ? 'pass' : 'fail';
  return (
    <Card>
      <CardHead title="SPF" badge={<StatusBadge tone={tone}>{label}</StatusBadge>} />
      <div style={{ padding: '10px 14px' }}>
        <KV k="record" v={r?.record ?? '—'} tone={r?.record ? 'text3' : undefined} />
        <KV
          k="lookups"
          v={r?.lookupCount != null ? `${r.lookupCount} / 10` : '—'}
          tone={r && r.lookupCount > 10 ? 'red' : r && r.lookupCount > 8 ? 'amber' : 'green'}
        />
        <KV
          k="issues"
          v={r && r.issues.length > 0 ? r.issues[0] : 'none'}
          tone={r && r.issues.length > 0 ? 'red' : 'green'}
        />
      </div>
    </Card>
  );
}

function DkimCard({ r }: { r: LiveDkim[] | undefined }) {
  const first = r?.[0];
  const loaded = !!first;
  const anyValid = !!r?.some((d) => d.valid);
  const tone = !loaded ? 'neutral' : anyValid ? 'healthy' : 'critical';
  const label = !loaded ? 'pending' : anyValid ? 'pass' : 'fail';
  return (
    <Card>
      <CardHead title="DKIM" badge={<StatusBadge tone={tone}>{label}</StatusBadge>} />
      <div style={{ padding: '10px 14px' }}>
        <KV k="selectors" v={r ? (r.map((d) => d.selector).join(', ') || '—') : '—'} tone="text3" />
        <KV
          k="valid"
          v={r ? `${r.filter((d) => d.valid).length} of ${r.length}` : '—'}
          tone={anyValid ? 'green' : 'red'}
        />
        <KV
          k="issues"
          v={first?.issues?.[0] ?? (r && r.length > 0 ? 'none' : '—')}
          tone={first?.issues && first.issues.length > 0 ? 'red' : 'green'}
        />
      </div>
    </Card>
  );
}

function DmarcCard({ r }: { r: LiveDmarc | undefined }) {
  const loaded = !!r;
  const valid = !!r?.valid;
  const tone = !loaded ? 'neutral' : valid ? 'healthy' : r?.policy ? 'warning' : 'critical';
  const label = !loaded ? 'pending' : valid ? 'pass' : r?.policy ? 'warn' : 'fail';
  return (
    <Card>
      <CardHead title="DMARC" badge={<StatusBadge tone={tone}>{label}</StatusBadge>} />
      <div style={{ padding: '10px 14px' }}>
        <KV
          k="policy"
          v={r?.policy ? `p=${r.policy}` : '—'}
          tone={r?.policy === 'reject' ? 'green' : r?.policy === 'quarantine' ? 'amber' : r?.policy === 'none' ? 'red' : undefined}
        />
        <KV
          k="rua"
          v={r?.hasRua ? 'configured' : 'missing'}
          tone={r?.hasRua ? 'green' : 'red'}
        />
        <KV
          k="issues"
          v={r && r.issues.length > 0 ? r.issues[0] : 'none'}
          tone={r && r.issues.length > 0 ? 'red' : 'green'}
        />
      </div>
    </Card>
  );
}

function MxCard({ mx }: { mx: string[] | undefined }) {
  const loaded = !!mx;
  const has = (mx?.length ?? 0) > 0;
  const tone = !loaded ? 'neutral' : has ? 'healthy' : 'critical';
  const label = !loaded ? 'pending' : has ? 'ok' : 'missing';
  return (
    <Card>
      <CardHead title="MX records" badge={<StatusBadge tone={tone}>{label}</StatusBadge>} />
      <div style={{ padding: '10px 14px' }}>
        {has ? (
          mx!.slice(0, 3).map((host, i) => (
            <KV key={host} k={`#${i + 1}`} v={host} tone="text3" />
          ))
        ) : (
          <KV k="hosts" v="none" tone="red" />
        )}
        <KV k="count" v={mx?.length ?? '—'} tone={has ? 'green' : 'red'} />
      </div>
    </Card>
  );
}

/* ---------- RBL grid ---------- */

export interface RblResultRow {
  checkedAt: Date;
  ipAddress: string | null;
  isListed: boolean | null;
  listedOn: string | null; // JSON string[]
}

function RblGrid({ latest }: { latest: RblResultRow | null }) {
  const listedSet = new Set<string>(
    latest?.listedOn ? (JSON.parse(latest.listedOn) as string[]) : [],
  );
  const checked = !!latest;
  const total = BLACKLISTS_META.length;
  const listedCount = listedSet.size;

  return (
    <Card>
      <CardHead
        title="Blacklist checks"
        badge={
          !checked ? <StatusBadge tone="neutral">not checked</StatusBadge>
          : listedCount > 0 ? <StatusBadge tone="critical">{listedCount} of {total} listed</StatusBadge>
          : <StatusBadge tone="healthy">all clean</StatusBadge>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        }}
      >
        {BLACKLISTS_META.map((bl, i) => {
          const isListed = listedSet.has(bl.name);
          const rowIdx = Math.floor(i / 4);
          const colIdx = i % 4;
          return (
            <div
              key={bl.name}
              style={{
                padding: '10px 12px',
                borderTop: rowIdx > 0 ? '1px solid var(--border)' : 'none',
                borderLeft: colIdx > 0 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {bl.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600,
                  color: !checked ? 'var(--text3)' : isListed ? 'var(--red)' : 'var(--green)',
                }}
              >
                {!checked ? '—' : isListed ? '✗ listed' : '✓ clean'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
                {checked ? `checked ${relativeTime(latest!.checkedAt)}` : 'no data'}
              </div>
            </div>
          );
        })}
      </div>
      {checked && listedCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--red-dim)',
            borderTop: '1px solid var(--red-border)',
          }}
        >
          <IconShield size={14} style={{ color: 'var(--red)' }} />
          <div style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--red)' }}>
            {latest?.ipAddress ?? 'IP'} listed on {[...listedSet].join(', ')}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- SMTP health ---------- */

function SmtpHealthCard({ domainId }: { domainId: string }) {
  const latest = trpc.checks.latestSmtp.useQuery({ domainId });
  const utils = trpc.useUtils();
  const runSmtp = trpc.checks.runSmtp.useMutation({
    onSuccess: () => utils.checks.latestSmtp.invalidate({ domainId }),
  });
  const row = latest.data;
  const tone: 'healthy' | 'warning' | 'critical' | 'neutral' =
    !row ? 'neutral' :
    row.error ? 'critical' :
    !row.connected ? 'critical' :
    row.tlsVersion ? 'healthy' : 'warning';
  const label = !row ? 'not checked' :
    row.error ? 'error' :
    !row.connected ? 'unreachable' :
    row.tlsVersion ? 'ok' : 'no TLS';

  const cells: Array<{ label: string; value: string; sub: string; tone?: 'green' | 'amber' | 'red' | 'text3' }> = [
    {
      label: 'Response time',
      value: row?.responseTimeMs != null ? `${row.responseTimeMs} ms` : '—',
      sub: row ? `${row.host}:${row.port}` : 'run a check to populate',
      tone: row && row.responseTimeMs != null ? (row.responseTimeMs > 500 ? 'amber' : 'green') : undefined,
    },
    {
      label: 'TLS version',
      value: row?.tlsVersion ?? (row?.starttlsOffered === false ? 'not offered' : '—'),
      sub: row?.tlsAuthorized === true ? 'certificate valid'
         : row?.tlsAuthorized === false ? 'certificate invalid'
         : 'verify via Certificates',
      tone: row?.tlsVersion ? 'green' : row ? 'red' : undefined,
    },
    {
      label: 'Banner',
      value: row?.banner ? row.banner.slice(0, 48) : '—',
      sub: row?.error ?? 'EHLO response',
      tone: row?.banner ? 'text3' : undefined,
    },
  ];

  return (
    <Card>
      <CardHead
        title="SMTP health"
        badge={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusBadge tone={tone}>{label}</StatusBadge>
            <button
              type="button"
              onClick={() => runSmtp.mutate({ domainId, port: 25 })}
              disabled={runSmtp.isPending}
              style={{
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                padding: '4px 8px', borderRadius: 6,
                background: 'transparent', color: 'var(--text2)',
                border: '1px solid var(--border2)', cursor: 'pointer',
              }}
            >
              {runSmtp.isPending ? 'Checking…' : 'Run check'}
            </button>
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {cells.map((c, i) => {
          const color = c.tone === 'green' ? 'var(--green)'
            : c.tone === 'amber' ? 'var(--amber)'
            : c.tone === 'red' ? 'var(--red)'
            : c.tone === 'text3' ? 'var(--text2)' : 'var(--text)';
          return (
            <div key={c.label} style={{ padding: '14px 16px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
              <div
                style={{
                  fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600,
                  color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em',
                }}
              >
                {c.label}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600, color, marginTop: 4, wordBreak: 'break-all' }}>
                {c.value}
              </div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                {c.sub}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- Main ---------- */

export function DomainOverview({ domainId }: { domainId: string }) {
  const live = trpc.checks.liveHealth.useQuery({ domainId });
  const bl = trpc.checks.latestBlacklist.useQuery({ domainId });
  const latest = bl.data?.[0] ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <SpfCard r={live.data?.spf as LiveSpf | undefined} />
        <DkimCard r={live.data?.dkim as LiveDkim[] | undefined} />
        <DmarcCard r={live.data?.dmarc as LiveDmarc | undefined} />
        <MxCard mx={live.data?.mx as string[] | undefined} />
      </div>
      <RblGrid latest={latest} />
      <SmtpHealthCard domainId={domainId} />
    </div>
  );
}

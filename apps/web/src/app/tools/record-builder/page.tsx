'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/lib/trpc';
import { PageHeader } from '@/components/page-header';
import { PillTabs, PillTabsList, PillTabsTrigger, PillTabsContent, PillTabsActiveStyle } from '@/components/pill-tabs';
import { StatusBadge } from '@/components/status-badge';
import {
  buildSpfRecord, countSpfLookups, COMMON_SPF_INCLUDES,
  buildDmarcRecord,
  type SpfComponent, type SpfPolicy, type DmarcPolicy,
} from '@mxwatch/monitor/record-builder';

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '10px 12px',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontFamily: 'var(--mono)',
          fontSize: 12,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={copy}
        style={{
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
          padding: '7px 12px', borderRadius: 7,
          background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', cursor: 'pointer',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function input(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    width: '100%',
    height: 34,
    padding: '0 10px',
    borderRadius: 7,
    border: '1px solid var(--border2)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    fontSize: 12,
    ...extra,
  };
}

/* ---------- SPF ---------- */

function SpfBuilder({ defaultDomain }: { defaultDomain: string }) {
  const [includes, setIncludes] = useState<Set<string>>(new Set());
  const [useMx, setUseMx] = useState(true);
  const [useA, setUseA] = useState(false);
  const [ip4, setIp4] = useState('');
  const [ip6, setIp6] = useState('');
  const [customInclude, setCustomInclude] = useState('');
  const [policy, setPolicy] = useState<SpfPolicy>('-all');

  const components: SpfComponent[] = useMemo(() => {
    const cs: SpfComponent[] = [];
    if (useMx) cs.push({ type: 'mx' });
    if (useA) cs.push({ type: 'a' });
    for (const v of ip4.split(/[\s,]+/).filter(Boolean)) cs.push({ type: 'ip4', value: v });
    for (const v of ip6.split(/[\s,]+/).filter(Boolean)) cs.push({ type: 'ip6', value: v });
    for (const inc of includes) cs.push({ type: 'include', value: inc });
    for (const v of customInclude.split(/[\s,]+/).filter(Boolean)) cs.push({ type: 'include', value: v });
    return cs;
  }, [useMx, useA, ip4, ip6, includes, customInclude]);

  const record = buildSpfRecord(components, policy);
  const lookups = countSpfLookups(components);

  function toggleInclude(v: string) {
    setIncludes((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v); else n.add(v);
      return n;
    });
  }

  const lookupTone: 'healthy' | 'warning' | 'critical' =
    lookups <= 7 ? 'healthy' : lookups <= 10 ? 'warning' : 'critical';
  const lookupLabel = lookups <= 10 ? `${lookups} / 10 lookups` : `${lookups} / 10 — over limit`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card title="1. Your mail server">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--sans)', fontSize: 13 }}>
            <input type="checkbox" checked={useMx} onChange={(e) => setUseMx(e.target.checked)} />
            Use this domain's MX records (<code style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>mx</code>)
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--sans)', fontSize: 13 }}>
            <input type="checkbox" checked={useA} onChange={(e) => setUseA(e.target.checked)} />
            Allow this domain's A record (<code style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>a</code>)
          </label>
          <div>
            <Label>IPv4 addresses / CIDRs (comma or space separated)</Label>
            <input value={ip4} onChange={(e) => setIp4(e.target.value)} placeholder="185.199.108.153 203.0.113.0/28" style={input()} />
          </div>
          <div>
            <Label>IPv6 addresses</Label>
            <input value={ip6} onChange={(e) => setIp6(e.target.value)} placeholder="2001:db8::1" style={input()} />
          </div>
        </div>
      </Card>

      <Card title="2. Third-party senders">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
          {COMMON_SPF_INCLUDES.map((i) => (
            <label key={i.value} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: includes.has(i.value) ? 'var(--blue-dim)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 12 }}>
              <input type="checkbox" checked={includes.has(i.value)} onChange={() => toggleInclude(i.value)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--text)' }}>{i.label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.value}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Label>Custom includes</Label>
          <input value={customInclude} onChange={(e) => setCustomInclude(e.target.value)} placeholder="spf.example.com another.example.com" style={input()} />
        </div>
      </Card>

      <Card title="3. Policy">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { v: '-all', label: '-all (hardfail — reject)' },
            { v: '~all', label: '~all (softfail — accept+tag)' },
            { v: '?all', label: '?all (neutral — rarely useful)' },
          ] as const).map((p) => (
            <button key={p.v} type="button" onClick={() => setPolicy(p.v)} style={{
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
              padding: '7px 12px', borderRadius: 7,
              background: policy === p.v ? 'var(--blue)' : 'transparent',
              color: policy === p.v ? '#fff' : 'var(--text2)',
              border: `1px solid ${policy === p.v ? 'var(--blue)' : 'var(--border2)'}`,
              cursor: 'pointer',
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>
            Publish as TXT on <span style={{ fontFamily: 'var(--mono)' }}>{defaultDomain}</span>
          </div>
          <StatusBadge tone={lookupTone}>{lookupLabel}</StatusBadge>
        </div>
        <CopyBlock text={record} />
        {lookups > 10 && (
          <div style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'var(--sans)' }}>
            Over the 10-lookup limit — receivers will treat SPF as PermError. Flatten heavy includes or drop providers you don't actually use.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- DMARC ---------- */

function DmarcBuilder({ defaultDomain, ruaDefault }: { defaultDomain: string; ruaDefault: string }) {
  const [policy, setPolicy] = useState<DmarcPolicy>('none');
  const [subdomainPolicy, setSubdomainPolicy] = useState<DmarcPolicy | ''>('');
  const [percentage, setPercentage] = useState(100);
  const [rua, setRua] = useState(ruaDefault);
  const [ruf, setRuf] = useState('');
  const [spfStrict, setSpfStrict] = useState(false);
  const [dkimStrict, setDkimStrict] = useState(false);

  const record = buildDmarcRecord({
    policy,
    subdomainPolicy: (subdomainPolicy as DmarcPolicy) || undefined,
    percentage,
    ruaEmail: rua,
    rufEmail: ruf || undefined,
    alignmentSpf: spfStrict ? 's' : 'r',
    alignmentDkim: dkimStrict ? 's' : 'r',
  });

  const migration = policy === 'none'
    ? 'Step 1: start here to gather aggregate reports without impacting delivery.'
    : policy === 'quarantine'
      ? 'Step 2: moving to quarantine — unaligned mail lands in spam.'
      : 'Step 3: reject — unaligned mail is dropped by receivers.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card title="1. Policy">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['none', 'quarantine', 'reject'] as DmarcPolicy[]).map((p) => (
            <button key={p} type="button" onClick={() => setPolicy(p)} style={{
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
              padding: '7px 12px', borderRadius: 7,
              background: policy === p ? 'var(--blue)' : 'transparent',
              color: policy === p ? '#fff' : 'var(--text2)',
              border: `1px solid ${policy === p ? 'var(--blue)' : 'var(--border2)'}`,
              cursor: 'pointer',
            }}>{p}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{migration}</div>
      </Card>

      <Card title="2. Reporting">
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <Label>Aggregate reports (rua) — required</Label>
            <input value={rua} onChange={(e) => setRua(e.target.value)} style={input()} placeholder={`dmarc@${defaultDomain}`} />
          </div>
          <div>
            <Label>Forensic reports (ruf) — optional</Label>
            <input value={ruf} onChange={(e) => setRuf(e.target.value)} style={input()} placeholder="forensics@yourdomain.com" />
          </div>
        </div>
      </Card>

      <Card title="3. Advanced">
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <Label>Rollout percentage: {percentage}%</Label>
            <input type="range" min={1} max={100} value={percentage} onChange={(e) => setPercentage(Number(e.target.value))} style={{ width: '100%' }} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              Only applies at p=quarantine or p=reject. Use pct&lt;100 to gradually apply policy.
            </div>
          </div>
          <div>
            <Label>Subdomain policy (sp)</Label>
            <select
              value={subdomainPolicy}
              onChange={(e) => setSubdomainPolicy(e.target.value as DmarcPolicy | '')}
              style={input({ fontFamily: 'var(--sans)' })}
            >
              <option value="">same as policy</option>
              <option value="none">none</option>
              <option value="quarantine">quarantine</option>
              <option value="reject">reject</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--sans)', fontSize: 12 }}>
              <input type="checkbox" checked={spfStrict} onChange={(e) => setSpfStrict(e.target.checked)} />
              Strict SPF alignment (aspf=s)
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--sans)', fontSize: 12 }}>
              <input type="checkbox" checked={dkimStrict} onChange={(e) => setDkimStrict(e.target.checked)} />
              Strict DKIM alignment (adkim=s)
            </label>
          </div>
        </div>
      </Card>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>
          Publish as TXT on <span style={{ fontFamily: 'var(--mono)' }}>_dmarc.{defaultDomain}</span>
        </div>
        <CopyBlock text={record} />
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export default function RecordBuilderPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const smtp = trpc.settings.smtpConfig.useQuery(undefined, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const domainName = domains.data?.[0]?.domain ?? 'example.com';
  const ruaDefault = smtp.data
    ? `${smtp.data.suggestedLocalPart}@${smtp.data.hostname}`
    : `dmarc@${domainName}`;

  return (
    <div className="space-y-5" style={{ maxWidth: 900 }}>
      <PageHeader title="Record builder" subtitle="Generate correct SPF and DMARC records with a live preview." />
      <PillTabsActiveStyle />
      <PillTabs defaultValue="spf">
        <PillTabsList>
          <PillTabsTrigger value="spf" className="pt-trigger">SPF</PillTabsTrigger>
          <PillTabsTrigger value="dmarc" className="pt-trigger">DMARC</PillTabsTrigger>
        </PillTabsList>
        <PillTabsContent value="spf">
          <SpfBuilder defaultDomain={domainName} />
        </PillTabsContent>
        <PillTabsContent value="dmarc">
          <DmarcBuilder defaultDomain={domainName} ruaDefault={ruaDefault} />
        </PillTabsContent>
      </PillTabs>
    </div>
  );
}

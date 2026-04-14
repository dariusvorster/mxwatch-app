'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { StatusBadge } from '@/components/status-badge';

type RecordType = 'TXT' | 'MX' | 'A' | 'AAAA';
type Region = 'Global' | 'US' | 'EU' | 'APAC' | 'RU';

interface PresetBase {
  label: string;
  recordType: RecordType;
  hostTemplate: string;   // {domain} gets substituted
  expectedKind: 'spf' | 'dmarc' | 'mx' | 'none';
}

const PRESETS: PresetBase[] = [
  { label: 'SPF',   recordType: 'TXT', hostTemplate: '{domain}',         expectedKind: 'spf' },
  { label: 'DMARC', recordType: 'TXT', hostTemplate: '_dmarc.{domain}',  expectedKind: 'dmarc' },
  { label: 'MX',    recordType: 'MX',  hostTemplate: '{domain}',         expectedKind: 'mx' },
  { label: 'A',     recordType: 'A',   hostTemplate: '{domain}',         expectedKind: 'none' },
];

export function DnsPropagationCard({ domainId, domain }: { domainId: string; domain: string }) {
  const snap = trpc.checks.latestDns.useQuery({ domainId });
  const check = trpc.propagation.check.useMutation();
  const [preset, setPreset] = useState<PresetBase>(PRESETS[0]!);

  function expectedFor(kind: PresetBase['expectedKind']): string | undefined {
    const s = snap.data;
    if (!s) return undefined;
    if (kind === 'spf' && s.spfRecord) return 'v=spf1';
    if (kind === 'dmarc' && s.dmarcRecord) return 'v=DMARC1';
    if (kind === 'mx' && s.mxRecords) {
      try {
        const first = (JSON.parse(s.mxRecords) as string[])[0];
        return first;
      } catch { return undefined; }
    }
    return undefined;
  }

  function runPreset(p: PresetBase) {
    setPreset(p);
    const hostname = p.hostTemplate.replace('{domain}', domain);
    const expectedValue = expectedFor(p.expectedKind);
    check.mutate({ domainId, recordType: p.recordType, hostname, expectedValue });
  }

  const data = check.data;
  const grouped = groupByRegion(data?.results ?? []);
  const regions: Region[] = ['Global', 'US', 'EU', 'APAC', 'RU'];

  return (
    <div
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>DNS propagation</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Query the same record from 19 public resolvers across 5 regions.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => runPreset(p)}
              disabled={check.isPending}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                fontWeight: 600,
                padding: '5px 10px',
                borderRadius: 6,
                background: preset.label === p.label ? 'var(--blue)' : 'transparent',
                color: preset.label === p.label ? '#fff' : 'var(--text2)',
                border: `1px solid ${preset.label === p.label ? 'var(--blue)' : 'var(--border2)'}`,
                cursor: 'pointer',
              }}
            >
              Check {p.label}
            </button>
          ))}
        </div>
      </div>

      {check.isPending ? (
        <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>Querying 19 resolvers…</div>
      ) : !data ? (
        <div style={{ padding: 16, fontSize: 13, color: 'var(--text3)' }}>
          Pick a record type above to run a propagation check.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: 'var(--text3)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              <span style={{ color: 'var(--text2)' }}>{data.hostname}</span>
              {' · '}
              {data.recordType}
            </span>
            {data.expectedValue && (
              <span>
                expected: <span style={{ color: 'var(--text2)' }}>{data.expectedValue.slice(0, 40)}{data.expectedValue.length > 40 ? '…' : ''}</span>
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--text2)' }}>
              {data.expectedValue
                ? `${data.propagatedCount} / ${data.totalResolvers} propagated`
                : `${data.propagatedCount} / ${data.totalResolvers} responded`}
            </span>
          </div>
          {regions.map((region) => {
            const list = grouped[region];
            if (!list || list.length === 0) return null;
            return (
              <div key={region}>
                <div
                  style={{
                    padding: '8px 14px',
                    fontFamily: 'var(--sans)',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    background: 'var(--bg)',
                    borderBottom: '1px solid var(--border)',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {region}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {list.map((r, i) => {
                    const tone: 'healthy' | 'warning' | 'critical' | 'neutral' = r.error
                      ? 'critical'
                      : data.expectedValue
                        ? (r.matches ? 'healthy' : 'warning')
                        : (r.values.length > 0 ? 'healthy' : 'critical');
                    const label = r.error
                      ? r.error
                      : data.expectedValue
                        ? (r.matches ? 'propagated' : 'stale')
                        : (r.values.length > 0 ? 'ok' : 'empty');
                    const colIdx = i % 2;
                    return (
                      <div
                        key={r.ip}
                        style={{
                          padding: '10px 14px',
                          borderLeft: colIdx > 0 ? '1px solid var(--border)' : 'none',
                          borderTop: i >= 2 ? '1px solid var(--border)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                            {r.resolver}
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                            {r.ip} · {r.responseMs} ms
                          </div>
                          {r.values.length > 0 && (
                            <div
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 10,
                                color: 'var(--text2)',
                                marginTop: 2,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={r.values.join(' | ')}
                            >
                              {r.values[0]}{r.values.length > 1 ? ` · +${r.values.length - 1}` : ''}
                            </div>
                          )}
                        </div>
                        <StatusBadge tone={tone}>{label}</StatusBadge>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function groupByRegion<T extends { region: Region }>(rows: T[]): Record<Region, T[]> {
  const out: Record<Region, T[]> = { Global: [], US: [], EU: [], APAC: [], RU: [] };
  for (const r of rows) out[r.region].push(r);
  return out;
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

type SortKey = 'score' | 'name' | 'checked';
type SortDir = 'asc' | 'desc';

export default function DomainsIndexPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const snapQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestDns({ domainId: d.id }, { enabled: !!session })),
  );
  const blQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestBlacklist({ domainId: d.id }, { enabled: !!session })),
  );

  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const rows = useMemo(() => {
    const list = (domains.data ?? []).map((d, i) => {
      const snap = snapQueries[i]?.data as { healthScore: number | null; checkedAt: Date } | null | undefined;
      const bl = blQueries[i]?.data as Array<{ isListed: boolean | null; listedOn: string | null }> | undefined;
      const latestBl = bl?.[0];
      const listed = latestBl?.isListed
        ? (JSON.parse(latestBl.listedOn ?? '[]') as string[]).length
        : 0;
      return {
        id: d.id,
        domain: d.domain,
        score: snap?.healthScore ?? null,
        checkedAt: snap?.checkedAt ?? null,
        listed,
      };
    });
    const term = q.trim().toLowerCase();
    const filtered = term ? list.filter((r) => r.domain.toLowerCase().includes(term)) : list;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.domain.localeCompare(b.domain);
      else if (sortKey === 'score') cmp = (a.score ?? 101) - (b.score ?? 101);
      else if (sortKey === 'checked') {
        const ta = a.checkedAt ? new Date(a.checkedAt).getTime() : 0;
        const tb = b.checkedAt ? new Date(b.checkedAt).getTime() : 0;
        cmp = tb - ta; // newest first natural
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [domains.data, snapQueries, blQueries, q, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  if (isPending || !session) return <div>Loading…</div>;

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Domains"
        subtitle={`${rows.length} monitored${q ? ' · filtered' : ''}`}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search domains…"
          style={{
            flex: 1, maxWidth: 360,
            fontFamily: 'var(--mono)', fontSize: 12,
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border2)', background: 'var(--surf)',
            color: 'var(--text)',
          }}
        />
        <Link
          href="/onboarding"
          style={{
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
            padding: '8px 14px', borderRadius: 8,
            background: 'var(--blue)', color: '#fff',
            border: '1px solid var(--blue)', textDecoration: 'none',
          }}
        >
          + Add domain
        </Link>
      </div>

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>
            {q ? 'No domains match your search.' : 'No domains yet.'}
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <SortHead label="Domain" active={sortKey === 'name'} dir={sortDir} onClick={() => toggle('name')} />
                <SortHead label="Score" active={sortKey === 'score'} dir={sortDir} onClick={() => toggle('score')} />
                <th style={headCell}>Blacklist</th>
                <SortHead label="Last checked" active={sortKey === 'checked'} dir={sortDir} onClick={() => toggle('checked')} />
                <th style={{ ...headCell, textAlign: 'right' }}>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={bodyCell}>
                    <Link href={`/domains/${r.id}`} style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                      {r.domain}
                    </Link>
                  </td>
                  <td style={bodyCell}>
                    {r.score == null ? (
                      <StatusBadge tone="neutral">pending</StatusBadge>
                    ) : r.score >= 80 ? (
                      <ScorePill score={r.score} tone="green" />
                    ) : r.score >= 60 ? (
                      <ScorePill score={r.score} tone="amber" />
                    ) : (
                      <ScorePill score={r.score} tone="red" />
                    )}
                  </td>
                  <td style={bodyCell}>
                    {r.listed > 0 ? (
                      <StatusBadge tone="critical">{r.listed} listed</StatusBadge>
                    ) : (
                      <StatusBadge tone="healthy">clean</StatusBadge>
                    )}
                  </td>
                  <td style={{ ...bodyCell, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                    {r.checkedAt ? relativeTime(r.checkedAt) : '—'}
                  </td>
                  <td style={{ ...bodyCell, textAlign: 'right' }}>
                    <Link href={`/domains/${r.id}`} style={linkBtn}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SortHead({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th style={headCell}>
      <button
        type="button"
        onClick={onClick}
        style={{
          fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit',
          color: active ? 'var(--text2)' : 'var(--text3)',
          textTransform: 'inherit',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {label}
        {active && <span style={{ fontSize: 9 }}>{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

function ScorePill({ score, tone }: { score: number; tone: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : 'var(--red)';
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color }}>
      {score}
    </span>
  );
}

const headCell: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontFamily: 'var(--sans)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};
const bodyCell: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const linkBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text2)',
  border: '1px solid var(--border2)',
  textDecoration: 'none',
};

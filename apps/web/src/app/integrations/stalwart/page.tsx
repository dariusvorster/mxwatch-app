'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SummaryCard } from '@/components/summary-card';
import { relativeTime } from '@/lib/alert-display';

export default function StalwartPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const list = trpc.stalwart.list.useQuery(undefined, { enabled: !!session });
  const utils = trpc.useUtils();
  const create = trpc.stalwart.create.useMutation({ onSuccess: () => utils.stalwart.list.invalidate() });
  const remove = trpc.stalwart.remove.useMutation({ onSuccess: () => utils.stalwart.list.invalidate() });
  const test = trpc.stalwart.test.useMutation({ onSuccess: () => utils.stalwart.list.invalidate() });
  const pullNow = trpc.stalwart.pullNow.useMutation({ onSuccess: () => utils.stalwart.list.invalidate() });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const res = await create.mutateAsync({
      name: String(fd.get('name')),
      baseUrl: String(fd.get('baseUrl')),
      token: String(fd.get('token')),
    });
    form.reset();
    setSelected(res.id);
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-5" style={{ maxWidth: 1100 }}>
      <PageHeader title="Stalwart" subtitle="Pull mail-server stats from Stalwart's management API and receive delivery-failure webhooks." />

      <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add Stalwart instance</div>
        <form onSubmit={onCreate} style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr auto' }}>
          <input name="name" required placeholder="homelabza.com mail" style={inputStyle} />
          <input name="baseUrl" required placeholder="https://mail.example.com" style={inputStyle} />
          <input name="token" required type="password" placeholder="management API token" style={inputStyle} />
          <button type="submit" disabled={create.isPending} style={btnPrimary}>
            {create.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length === 0 ? (
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, fontSize: 13, color: 'var(--text3)' }}>
            No integrations yet.
          </div>
        ) : rows.map((r) => (
          <IntegrationCard
            key={r.id}
            row={r}
            expanded={selected === r.id}
            onExpand={() => setSelected(selected === r.id ? null : r.id)}
            onRemove={() => { if (confirm(`Remove integration "${r.name}"?`)) remove.mutate({ id: r.id }); }}
            onTest={() => test.mutate({ id: r.id })}
            onPull={() => pullNow.mutate({ id: r.id })}
            pulling={pullNow.isPending}
            testing={test.isPending}
          />
        ))}
      </div>
    </div>
  );
}

type Row = NonNullable<ReturnType<typeof trpc.stalwart.list.useQuery>['data']>[number];

function IntegrationCard({ row, expanded, onExpand, onRemove, onTest, onPull, pulling, testing }: {
  row: Row;
  expanded: boolean;
  onExpand: () => void;
  onRemove: () => void;
  onTest: () => void;
  onPull: () => void;
  pulling: boolean;
  testing: boolean;
}) {
  const current = trpc.stalwart.current.useQuery({ id: row.id }, { enabled: expanded });
  const events = trpc.stalwart.events.useQuery({ id: row.id, limit: 20 }, { enabled: expanded });
  const webhook = trpc.stalwart.webhookConfig.useQuery({ id: row.id }, { enabled: expanded });

  const tone = row.status === 'ok' ? 'healthy' : row.status === 'error' ? 'critical' : 'neutral';

  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: expanded ? '1px solid var(--border)' : 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600 }}>{row.name}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
            {row.baseUrl}
            {row.lastPulledAt && <span> · last pull {relativeTime(row.lastPulledAt)}</span>}
            {row.lastError && <span style={{ color: 'var(--red)' }}> · {row.lastError}</span>}
          </div>
        </div>
        <StatusBadge tone={tone}>{row.status}</StatusBadge>
        <button type="button" onClick={onTest} disabled={testing} style={btnOutline}>{testing ? 'Testing…' : 'Test'}</button>
        <button type="button" onClick={onPull} disabled={pulling} style={btnOutline}>{pulling ? 'Pulling…' : 'Pull now'}</button>
        <button type="button" onClick={onExpand} style={btnOutline}>{expanded ? 'Hide' : 'Expand'}</button>
        <button type="button" onClick={onRemove} style={btnDestructive}>Remove</button>
      </div>

      {expanded && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {current.data ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <SummaryCard label="Queue depth" value={current.data.queueDepth ?? '—'} valueTone={(current.data.queueDepth ?? 0) > 0 ? 'amber' : 'green'} />
              <SummaryCard label="Failed" value={current.data.queueFailed ?? '—'} valueTone={(current.data.queueFailed ?? 0) > 0 ? 'red' : 'green'} />
              <SummaryCard label="Delivered 24h" value={current.data.delivered24h ?? '—'} valueTone="blue" />
              <SummaryCard label="TLS %" value={current.data.tlsPercent != null ? `${current.data.tlsPercent}%` : '—'} valueScore={current.data.tlsPercent ?? undefined} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>No snapshot yet. Click Pull now to fetch.</div>
          )}

          {webhook.data && (
            <div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Webhook config
              </div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                Configure Stalwart to POST events here. Sign each body with HMAC-SHA256 using the secret below and send the hex digest in <code>{webhook.data.header}</code>.
              </div>
              <pre style={preStyle}>{webhook.data.url}</pre>
              <pre style={preStyle}>secret: {webhook.data.secret}</pre>
            </div>
          )}

          {events.data && events.data.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Recent events ({events.data.length})
              </div>
              {events.data.slice(0, 10).map((e) => (
                <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <StatusBadge tone={e.type.includes('fail') || e.type.includes('reject') ? 'critical' : 'neutral'}>{e.type}</StatusBadge>
                  <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.detail ? e.detail.slice(0, 140) : ''}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{relativeTime(e.occurredAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: '0 10px',
  borderRadius: 7,
  border: '1px solid var(--border2)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--mono)',
  fontSize: 12,
};

const btnPrimary: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
  padding: '0 14px', height: 36, borderRadius: 7,
  background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)', cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
  padding: '6px 10px', borderRadius: 6,
  background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border2)', cursor: 'pointer',
};

const btnDestructive: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
  padding: '6px 10px', borderRadius: 6,
  background: 'transparent', color: 'var(--red)', border: '1px solid var(--red-border)', cursor: 'pointer',
};

const preStyle: React.CSSProperties = {
  margin: 0, padding: '10px 12px',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  fontFamily: 'var(--mono)', fontSize: 12,
  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  marginBottom: 6,
};

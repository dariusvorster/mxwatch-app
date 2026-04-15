'use client';
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { StatusBadge } from '@/components/status-badge';
import type { DomainArchitecture, OutboundProvider } from '@/lib/domain-topology';

type Domain = {
  id: string;
  architecture: string | null;
  sendingIp: string | null;
  sendingIps: string | null;
  smtpCheckHost: string | null;
  relayHost: string | null;
  internalHost: string | null;
  outboundProvider: string | null;
};

const ARCHITECTURES: Array<{ value: DomainArchitecture; label: string; desc: string }> = [
  { value: 'direct',    label: 'Direct',        desc: 'Mail server is publicly reachable and sends on its own IP.' },
  { value: 'nat_relay', label: 'NAT + relay',   desc: 'Internal mail server sends via a VPS / WireGuard relay (your real setup).' },
  { value: 'split',     label: 'Split',         desc: 'Self-hosted inbound, third-party outbound (Resend, SES, etc).' },
  { value: 'managed',   label: 'Fully managed', desc: 'All mail via a managed provider — MxWatch skips SMTP probes.' },
];

const PROVIDERS: Array<{ value: OutboundProvider; label: string }> = [
  { value: 'resend',   label: 'Resend' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'postmark', label: 'Postmark' },
  { value: 'custom',   label: 'Other' },
];

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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
      {children}
    </div>
  );
}

export function DomainTopologyCard({ domain }: { domain: Domain }) {
  const utils = trpc.useUtils();
  const save = trpc.domains.setTopology.useMutation({
    onSuccess: () => utils.domains.get.invalidate({ id: domain.id }),
  });

  const [architecture, setArchitecture] = useState<DomainArchitecture>(
    (domain.architecture as DomainArchitecture) ?? 'direct',
  );
  const [sendingIpsText, setSendingIpsText] = useState<string>(
    (() => {
      if (domain.sendingIps) {
        try { const arr = JSON.parse(domain.sendingIps) as string[]; if (Array.isArray(arr)) return arr.join(', '); } catch {}
      }
      return domain.sendingIp ?? '';
    })(),
  );
  const [smtpCheckHost, setSmtpCheckHost] = useState(domain.smtpCheckHost ?? '');
  const [relayHost, setRelayHost] = useState(domain.relayHost ?? '');
  const [internalHost, setInternalHost] = useState(domain.internalHost ?? '');
  const [outboundProvider, setOutboundProvider] = useState<OutboundProvider | ''>(
    (domain.outboundProvider as OutboundProvider) ?? '',
  );
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (save.isSuccess) {
      setSaved('saved');
      const t = setTimeout(() => setSaved(null), 1500);
      return () => clearTimeout(t);
    }
    if (save.error) setSaved(save.error.message);
  }, [save.isSuccess, save.error]);

  function onSave() {
    const ips = sendingIpsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    save.mutate({
      id: domain.id,
      architecture,
      sendingIps: ips,
      smtpCheckHost: smtpCheckHost || null,
      relayHost: relayHost || null,
      internalHost: internalHost || null,
      outboundProvider: outboundProvider || null,
    });
  }

  const showSendingIps = architecture !== 'managed';
  const showSmtpHost = architecture === 'direct' || architecture === 'split';
  const showRelay = architecture === 'nat_relay';
  const showProvider = architecture === 'split' || architecture === 'managed';

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
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>Mail server architecture</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            How mail leaves your setup. Drives which IPs we RBL-check and whether we probe SMTP.
          </div>
        </div>
        {saved && <StatusBadge tone={saved === 'saved' ? 'healthy' : 'critical'}>{saved}</StatusBadge>}
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <Label>Architecture</Label>
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {ARCHITECTURES.map((a) => {
              const active = architecture === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setArchitecture(a.value)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${active ? 'var(--blue-border)' : 'var(--border)'}`,
                    background: active ? 'var(--blue-dim)' : 'var(--surf)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, color: active ? 'var(--blue)' : 'var(--text)' }}>
                    {a.label}
                  </div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}>
                    {a.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {showRelay && (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <div>
              <Label>Relay IP / hostname (public)</Label>
              <input value={relayHost} onChange={(e) => setRelayHost(e.target.value)} placeholder="vps.example.com or 23.95.170.217" style={input()} />
            </div>
            <div>
              <Label>Internal mail server (optional)</Label>
              <input value={internalHost} onChange={(e) => setInternalHost(e.target.value)} placeholder="192.168.69.12" style={input()} />
            </div>
          </div>
        )}

        {showSmtpHost && (
          <div>
            <Label>SMTP probe host (optional)</Label>
            <input
              value={smtpCheckHost}
              onChange={(e) => setSmtpCheckHost(e.target.value)}
              placeholder={architecture === 'split' ? 'inbound.example.com' : 'leave blank to use primary MX'}
              style={input()}
            />
          </div>
        )}

        {showProvider && (
          <div>
            <Label>Outbound provider</Label>
            <select
              value={outboundProvider}
              onChange={(e) => setOutboundProvider(e.target.value as OutboundProvider | '')}
              style={input({ fontFamily: 'var(--sans)' })}
            >
              <option value="">Pick one…</option>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        )}

        {showSendingIps && (
          <div>
            <Label>Sending IPs — checked against RBLs (comma or space separated)</Label>
            <input
              value={sendingIpsText}
              onChange={(e) => setSendingIpsText(e.target.value)}
              placeholder={architecture === 'nat_relay' ? '23.95.170.217' : '185.199.108.153'}
              style={input()}
            />
            <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {architecture === 'split'
                ? 'Add your outbound provider\u2019s shared IPs if you know them, or leave blank — most providers rotate IPs and RBL checks aren\u2019t meaningful.'
                : architecture === 'nat_relay'
                  ? 'Usually just the relay IP (what receivers see). Add more if your VPS has multiple addresses.'
                  : 'Comma-separated list. Each IP is RBL-checked every 6 hours.'}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSave}
            disabled={save.isPending}
            style={{
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
              padding: '8px 14px', borderRadius: 7,
              background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)',
              cursor: 'pointer',
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

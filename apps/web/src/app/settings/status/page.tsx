'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/lib/trpc';
import { PageHeader } from '@/components/page-header';

export default function StatusSettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();

  const q = trpc.settings.getStatusToken.useQuery(undefined, { enabled: !!session });
  const generate = trpc.settings.generateStatusToken.useMutation({
    onSuccess: () => utils.settings.getStatusToken.invalidate(),
  });
  const revoke = trpc.settings.revokeStatusToken.useMutation({
    onSuccess: () => utils.settings.getStatusToken.invalidate(),
  });
  const setDigest = trpc.settings.setDigestEnabled.useMutation({
    onSuccess: () => utils.settings.getStatusToken.invalidate(),
  });

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;

  const token = q.data?.token ?? null;
  const digestEnabled = q.data?.digestEnabled ?? true;
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const statusUrl = token ? `${appUrl}/status/${token}` : null;

  function copy() {
    if (!statusUrl) return;
    navigator.clipboard.writeText(statusUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Status page"
        subtitle="Share a public health summary of your domains — no login required."
      />

      {/* Status page token card */}
      <div style={{
        background: 'var(--surf)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)',
        }}>
          Public status URL
        </div>
        <div style={{ padding: '18px' }}>
          {token ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg2)', border: '1px solid var(--border2)',
                borderRadius: 8, padding: '9px 12px',
                fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)',
                wordBreak: 'break-all',
              }}>
                <span style={{ flex: 1 }}>{statusUrl}</span>
                <button
                  type="button"
                  onClick={copy}
                  style={{
                    flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
                    padding: '4px 10px', borderRadius: 6,
                    background: copied ? 'var(--green-dim)' : 'var(--surf)',
                    color: copied ? 'var(--green)' : 'var(--text2)',
                    border: '1px solid var(--border2)', cursor: 'pointer',
                  }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => window.open(statusUrl!, '_blank')}
                  style={outlineBtn}
                >
                  Preview →
                </button>
                <button
                  type="button"
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                  style={outlineBtn}
                >
                  Rotate token
                </button>
                <button
                  type="button"
                  onClick={() => revoke.mutate()}
                  disabled={revoke.isPending}
                  style={{ ...outlineBtn, color: 'var(--red)', borderColor: 'var(--red-border)' }}
                >
                  Disable
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text3)', margin: '0 0 14px' }}>
                No status page enabled. Generate a token to create a shareable URL that shows
                your domain health without requiring a login.
              </p>
              <button
                type="button"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                style={primaryBtn}
              >
                {generate.isPending ? 'Generating…' : 'Generate status page'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Weekly digest card */}
      <div style={{
        background: 'var(--surf)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)',
        }}>
          Weekly digest email
        </div>
        <div style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text)' }}>
              Monday morning health summary
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
              Sent to <span style={{ fontFamily: 'var(--mono)' }}>{session.user.email}</span> at 09:00 UTC every Monday.
              Includes domain scores, SPF/DKIM/DMARC status, and RBL listings.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDigest.mutate({ enabled: !digestEnabled })}
            disabled={setDigest.isPending}
            style={{
              flexShrink: 0,
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
              padding: '6px 14px', borderRadius: 7,
              background: digestEnabled ? 'var(--green-dim)' : 'var(--surf2)',
              color: digestEnabled ? 'var(--green)' : 'var(--text3)',
              border: `1px solid ${digestEnabled ? 'var(--green-border)' : 'var(--border2)'}`,
              cursor: 'pointer',
            }}
          >
            {digestEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>
    </div>
  );
}

const outlineBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
  padding: '6px 12px', borderRadius: 7,
  background: 'transparent', color: 'var(--text2)',
  border: '1px solid var(--border2)', cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
  padding: '8px 16px', borderRadius: 7,
  background: 'var(--blue)', color: '#fff',
  border: 'none', cursor: 'pointer',
};

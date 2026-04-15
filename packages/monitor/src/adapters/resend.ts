import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, RelayInboxSetupResult,
  ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Resend adapter. REST API, Bearer token. Queue / auth failures aren't
 * concepts in cloud providers — those throw AdapterUnsupported.
 * config.apiToken is the Resend API key.
 */
export class ResendAdapter implements MailServerAdapter {
  readonly type = 'resend' as const;
  readonly displayName = 'Resend';

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${config.apiToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, message: (body as any)?.message ?? `Resend ${res.status}` };
      }
      const data = await res.json() as { data?: unknown[] };
      const count = Array.isArray(data.data) ? data.data.length : 0;
      return { ok: true, message: `Connected to Resend — ${count} domain${count === 1 ? '' : 's'}` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const res = await fetch('https://api.resend.com/emails?limit=100', {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    }).catch(() => null);
    if (!res || !res.ok) {
      return zeroStats('resend');
    }
    const data = await res.json().catch(() => ({})) as any;
    const rows: any[] = Array.isArray(data.data) ? data.data : [];
    const since = Date.now() - 24 * 3600 * 1000;
    const recent = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() >= since);
    const delivered = recent.filter((r) => r.last_event === 'delivered').length;
    const bounced = recent.filter((r) => r.last_event === 'bounced').length;
    const rejected = recent.filter((r) => r.last_event === 'rejected' || r.last_event === 'failed').length;
    return {
      queueDepth: 0, queueFailed: 0,
      delivered24h: delivered, bounced24h: bounced,
      rejected24h: rejected, deferred24h: 0,
      tlsPercent: 100, // Resend is HTTPS/TLS by definition
      serverVersion: 'resend',
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('ResendAdapter', 'getQueue');
  }
  async getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]> {
    const res = await fetch(`https://api.resend.com/emails?limit=${limit}`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    }).catch(() => null);
    if (!res || !res.ok) return [];
    const data = await res.json().catch(() => ({})) as any;
    const rows: any[] = Array.isArray(data.data) ? data.data : [];
    return rows
      .filter((r) => r.created_at && new Date(r.created_at) >= since)
      .map((r) => {
        const to = String((Array.isArray(r.to) ? r.to[0] : r.to) ?? '').toLowerCase();
        return {
          id: String(r.id ?? ''),
          timestamp: new Date(r.created_at),
          type: mapResendEvent(r.last_event),
          from: String(r.from ?? ''),
          to,
          recipientDomain: to.includes('@') ? to.split('@').pop()! : '',
          size: 0, delay: 0, tlsUsed: true,
          errorMessage: r.last_error ?? undefined,
        } satisfies DeliveryEvent;
      });
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('ResendAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('ResendAdapter', 'getRecipientDomainStats');
  }

  async setupRelayInbox(params: {
    config: AdapterConfig;
    webhookUrl: string;
    webhookSecret: string;
    inboundDomain: string;
  }): Promise<RelayInboxSetupResult> {
    try {
      const res = await fetch('https://api.resend.com/inbound/routes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          domain: params.inboundDomain,
          recipient: 'mxwatch-test-*',
          destination: params.webhookUrl,
        }),
      });
      const pattern = `mxwatch-test-*@${params.inboundDomain}`;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          ok: false, catchallAddressPattern: pattern,
          setupInstructions:
            `Automatic setup failed (${(body as any)?.message ?? res.status}). In the Resend dashboard ` +
            `create an Inbound Route: domain ${params.inboundDomain}, recipient mxwatch-test-*, ` +
            `destination ${params.webhookUrl}.`,
          message: `Resend ${res.status}`,
        };
      }
      return { ok: true, catchallAddressPattern: pattern, message: 'Inbound route created on Resend.' };
    } catch (e: any) {
      return {
        ok: false, catchallAddressPattern: `mxwatch-test-*@${params.inboundDomain}`,
        setupInstructions: `Network error — create the Inbound Route manually in the Resend dashboard.`,
        message: e?.message ?? 'Network error',
      };
    }
  }
}

function mapResendEvent(e: unknown): DeliveryEvent['type'] {
  switch (String(e)) {
    case 'delivered': return 'delivered';
    case 'bounced':
    case 'rejected':
    case 'failed': return 'bounced';
    default: return 'delivered';
  }
}

export function zeroStats(version: string): ServerStats {
  return {
    queueDepth: 0, queueFailed: 0,
    delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0,
    tlsPercent: 0, serverVersion: version,
  };
}

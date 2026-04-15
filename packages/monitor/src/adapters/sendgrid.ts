import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * SendGrid adapter. Bearer token at api.sendgrid.com.
 * config.apiToken = SendGrid API key (Full Access or at least Stats:Read).
 */
export class SendGridAdapter implements MailServerAdapter {
  readonly type = 'sendgrid' as const;
  readonly displayName = 'SendGrid';

  private headers(config: AdapterConfig) {
    return { Authorization: `Bearer ${config.apiToken}`, Accept: 'application/json' };
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/scopes', { headers: this.headers(config) });
      if (!res.ok) return { ok: false, message: `SendGrid ${res.status}` };
      return { ok: true, message: 'Connected to SendGrid' };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const start = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.sendgrid.com/v3/stats?start_date=${start}`,
      { headers: this.headers(config) },
    ).catch(() => null);
    if (!res || !res.ok) return zero();
    const data: any = await res.json().catch(() => []);
    // SendGrid returns an array of dates, each with stats[0].metrics.
    const metrics = Array.isArray(data)
      ? data.reduce((m, row) => m ?? row?.stats?.[0]?.metrics, null as any)
      : null;
    return {
      queueDepth: 0, queueFailed: 0,
      delivered24h: Number(metrics?.delivered ?? 0),
      bounced24h: Number(metrics?.bounces ?? 0),
      rejected24h: Number(metrics?.blocks ?? 0),
      deferred24h: Number(metrics?.deferred ?? 0),
      tlsPercent: 100,
      serverVersion: 'sendgrid',
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('SendGridAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    // SendGrid doesn't expose a general messages list on the free tier; the
    // Event Webhook is the canonical feed. Return [] and rely on webhook.
    return [];
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('SendGridAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('SendGridAdapter', 'getRecipientDomainStats');
  }
}

function zero(): ServerStats {
  return { queueDepth: 0, queueFailed: 0, delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0, tlsPercent: 0, serverVersion: 'sendgrid' };
}

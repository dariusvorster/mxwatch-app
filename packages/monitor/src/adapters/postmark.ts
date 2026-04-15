import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Postmark adapter. REST API, X-Postmark-Server-Token header.
 * config.apiToken = the Postmark Server Token.
 */
export class PostmarkAdapter implements MailServerAdapter {
  readonly type = 'postmark' as const;
  readonly displayName = 'Postmark';

  private headers(config: AdapterConfig) {
    return { 'X-Postmark-Server-Token': config.apiToken, Accept: 'application/json' };
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const res = await fetch('https://api.postmarkapp.com/server', { headers: this.headers(config) });
      if (!res.ok) return { ok: false, message: `Postmark ${res.status}` };
      const data = await res.json() as any;
      return { ok: true, message: `Connected — server "${data.Name ?? 'unknown'}"`, version: data.DeliveryType ?? undefined };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.postmarkapp.com/stats/outbound?fromdate=${from}&todate=${to}`,
      { headers: this.headers(config) },
    ).catch(() => null);
    const data: any = res && res.ok ? await res.json().catch(() => ({})) : {};
    return {
      queueDepth: 0, queueFailed: 0,
      delivered24h: Number(data.Sent ?? 0),
      bounced24h: Number(data.Bounced ?? 0),
      rejected24h: Number(data.SMTPApiErrors ?? 0),
      deferred24h: Number(data.Deferred ?? 0),
      tlsPercent: 100,
      serverVersion: 'postmark',
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('PostmarkAdapter', 'getQueue');
  }
  async getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]> {
    const res = await fetch(
      `https://api.postmarkapp.com/messages/outbound?count=${limit}&offset=0`,
      { headers: this.headers(config) },
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const data: any = await res.json().catch(() => ({}));
    const rows: any[] = Array.isArray(data.Messages) ? data.Messages : [];
    return rows
      .filter((m) => m.ReceivedAt && new Date(m.ReceivedAt) >= since)
      .map((m) => {
        const to = String((m.To?.[0]?.Email ?? m.Recipients?.[0]) ?? '').toLowerCase();
        return {
          id: String(m.MessageID ?? ''),
          timestamp: new Date(m.ReceivedAt),
          type: m.Status === 'Delivered' ? 'delivered'
            : m.Status === 'Bounced' ? 'bounced'
            : m.Status === 'Queued' ? 'deferred' : 'delivered',
          from: String(m.From ?? ''),
          to,
          recipientDomain: to.includes('@') ? to.split('@').pop()! : '',
          size: 0, delay: 0, tlsUsed: true,
          errorMessage: m.ErrorCode ? `Error ${m.ErrorCode}` : undefined,
        } satisfies DeliveryEvent;
      });
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('PostmarkAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('PostmarkAdapter', 'getRecipientDomainStats');
  }
}

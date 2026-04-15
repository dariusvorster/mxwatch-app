import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Mailgun adapter. Basic auth (api:<key>). Region selectable via
 * config.extras.region ('us' | 'eu', default 'us'). Domain comes from
 * config.extras.domain — required for stats endpoints.
 */
export class MailgunAdapter implements MailServerAdapter {
  readonly type = 'mailgun' as const;
  readonly displayName = 'Mailgun';

  private base(config: AdapterConfig) {
    return config.extras?.region === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net';
  }

  private headers(config: AdapterConfig) {
    return {
      Authorization: `Basic ${Buffer.from(`api:${config.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    };
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    const domain = config.extras?.domain;
    if (!domain) return { ok: false, message: 'Provide extras.domain (your Mailgun sending domain)' };
    try {
      const res = await fetch(`${this.base(config)}/v3/domains/${domain}`, { headers: this.headers(config) });
      if (!res.ok) return { ok: false, message: `Mailgun ${res.status}` };
      return { ok: true, message: `Connected — domain ${domain}` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const domain = config.extras?.domain;
    if (!domain) return zero();
    const res = await fetch(
      `${this.base(config)}/v3/${domain}/stats/total?event=delivered&event=failed&event=bounced&duration=1d`,
      { headers: this.headers(config) },
    ).catch(() => null);
    if (!res || !res.ok) return zero();
    const data: any = await res.json().catch(() => ({}));
    const stats: any[] = Array.isArray(data.stats) ? data.stats : [];
    const sum = (k: string, sub?: string) => stats.reduce((s, row) => s + Number((sub ? row[k]?.[sub] : row[k]?.total) ?? 0), 0);
    return {
      queueDepth: 0, queueFailed: 0,
      delivered24h: sum('delivered'),
      bounced24h: sum('failed', 'permanent') + sum('bounced'),
      rejected24h: sum('rejected'),
      deferred24h: sum('failed', 'temporary'),
      tlsPercent: 100,
      serverVersion: 'mailgun',
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('MailgunAdapter', 'getQueue');
  }
  async getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]> {
    const domain = config.extras?.domain;
    if (!domain) return [];
    const res = await fetch(
      `${this.base(config)}/v3/${domain}/events?limit=${Math.min(limit, 300)}&begin=${Math.floor(since.getTime() / 1000)}`,
      { headers: this.headers(config) },
    ).catch(() => null);
    if (!res || !res.ok) return [];
    const data: any = await res.json().catch(() => ({}));
    const items: any[] = Array.isArray(data.items) ? data.items : [];
    return items.map((e) => {
      const to = String(e.recipient ?? '').toLowerCase();
      return {
        id: String(e.id ?? ''),
        timestamp: new Date((e.timestamp ?? 0) * 1000),
        type: e.event === 'delivered' ? 'delivered'
          : e.event === 'failed' && e.severity === 'temporary' ? 'deferred'
          : e.event === 'failed' ? 'bounced'
          : e.event === 'rejected' ? 'rejected' : 'delivered',
        from: String(e.from ?? ''),
        to,
        recipientDomain: to.includes('@') ? to.split('@').pop()! : '',
        size: Number(e.storage?.size ?? 0), delay: 0, tlsUsed: true,
        errorMessage: e['delivery-status']?.description ?? undefined,
      } satisfies DeliveryEvent;
    });
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('MailgunAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('MailgunAdapter', 'getRecipientDomainStats');
  }
}

function zero(): ServerStats {
  return { queueDepth: 0, queueFailed: 0, delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0, tlsPercent: 0, serverVersion: 'mailgun' };
}

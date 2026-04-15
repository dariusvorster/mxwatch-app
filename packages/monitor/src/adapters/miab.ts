import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Mail-in-a-Box adapter. Basic auth against admin@domain + password.
 * Uses config.apiToken as `username:password` (the integration form is
 * responsible for combining them). Stats come from /admin/status/checks.
 */
export class MiabAdapter implements MailServerAdapter {
  readonly type = 'miab' as const;
  readonly displayName = 'Mail-in-a-Box';

  private headers(config: AdapterConfig) {
    return {
      Authorization: `Basic ${Buffer.from(config.apiToken).toString('base64')}`,
      Accept: 'application/json',
    };
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const url = `${config.baseUrl.replace(/\/$/, '')}/admin/me`;
      const res = await fetch(url, { headers: this.headers(config) });
      if (!res.ok) return { ok: false, message: `MIAB ${res.status}` };
      const data = await res.json().catch(() => ({})) as any;
      return { ok: true, message: `Connected to Mail-in-a-Box (${data.email ?? 'admin'})` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    try {
      const url = `${config.baseUrl.replace(/\/$/, '')}/admin/status/checks`;
      const res = await fetch(url, { headers: this.headers(config) });
      if (!res.ok) return zero('miab');
      const data = await res.json().catch(() => []) as any[];
      const checks = Array.isArray(data) ? data : [];
      const failed = checks.filter((c) => c.type === 'error' || c.type === 'warning').length;
      return {
        queueDepth: 0, queueFailed: failed,
        delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0,
        tlsPercent: 100,
        serverVersion: `miab (${checks.length} system checks, ${failed} issue${failed === 1 ? '' : 's'})`,
      };
    } catch {
      return zero('miab');
    }
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('MiabAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('MiabAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('MiabAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('MiabAdapter', 'getRecipientDomainStats');
  }
}

function zero(version: string): ServerStats {
  return { queueDepth: 0, queueFailed: 0, delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0, tlsPercent: 0, serverVersion: version };
}

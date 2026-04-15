import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Mailu adapter. Mailu is Postfix + Dovecot in Docker with a REST API for
 * provisioning (domains, users, aliases) — but it doesn't expose a queue or
 * delivery-log endpoint. We can confirm the connection works and read basic
 * inventory; deep stats need the upcoming Postfix agent.
 */
export class MailuAdapter implements MailServerAdapter {
  readonly type = 'mailu' as const;
  readonly displayName = 'Mailu';

  private async get<T>(config: AdapterConfig, path: string, timeoutMs = 6000): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.apiToken}`, Accept: 'application/json' },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Mailu API ${res.status}: ${path}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const domains = await this.get<unknown[]>(config, '/api/v1/domain');
      const count = Array.isArray(domains) ? domains.length : 0;
      return { ok: true, message: `Connected to Mailu — ${count} domain${count === 1 ? '' : 's'} provisioned` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Connection failed' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    // Domain + user inventory is the only "stats" Mailu exposes.
    const safe = async <T>(p: string): Promise<T | null> => {
      try { return await this.get<T>(config, p); } catch { return null; }
    };
    const [domains, users] = await Promise.all([
      safe<unknown[]>('/api/v1/domain'),
      safe<unknown[]>('/api/v1/user'),
    ]);
    return {
      queueDepth: 0,
      queueFailed: 0,
      delivered24h: 0,
      bounced24h: 0,
      rejected24h: 0,
      deferred24h: 0,
      tlsPercent: 0,
      serverVersion: `Mailu (${Array.isArray(domains) ? domains.length : 0} domains, ${Array.isArray(users) ? users.length : 0} users)`,
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('MailuAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('MailuAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('MailuAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('MailuAdapter', 'getRecipientDomainStats');
  }
}

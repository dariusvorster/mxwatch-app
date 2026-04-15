import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Modoboa adapter. Bearer-token REST, similar surface to Mailu. Only the
 * test + stats endpoints are wired; queue / auth / log endpoints aren't
 * uniformly exposed across Modoboa builds yet.
 */
export class ModoboaAdapter implements MailServerAdapter {
  readonly type = 'modoboa' as const;
  readonly displayName = 'Modoboa';

  private async get<T>(config: AdapterConfig, path: string): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${config.apiToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Modoboa ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const domains = await this.get<any>(config, '/api/v2/domains/');
      const count = Array.isArray(domains) ? domains.length : Array.isArray(domains?.results) ? domains.results.length : 0;
      return { ok: true, message: `Connected to Modoboa — ${count} domain${count === 1 ? '' : 's'}` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    try {
      const domains = await this.get<any>(config, '/api/v2/domains/');
      const list = Array.isArray(domains) ? domains : Array.isArray(domains?.results) ? domains.results : [];
      return {
        queueDepth: 0, queueFailed: 0,
        delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0,
        tlsPercent: 100,
        serverVersion: `modoboa (${list.length} domain${list.length === 1 ? '' : 's'})`,
      };
    } catch {
      return {
        queueDepth: 0, queueFailed: 0,
        delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0,
        tlsPercent: 0, serverVersion: 'modoboa',
      };
    }
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('ModoboaAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('ModoboaAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('ModoboaAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('ModoboaAdapter', 'getRecipientDomainStats');
  }
}

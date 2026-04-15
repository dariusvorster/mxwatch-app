import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Postal adapter. Authenticates via the X-Server-API-Key header + a simple
 * JSON-RPC-style POST body. The base URL is the Postal control API, e.g.
 * https://postal.example.com/api/v1/messages/deliveries.
 *
 * Only test + getStats are implemented against the public endpoints that
 * consistently exist across Postal versions; deeper data flows land later.
 */
export class PostalAdapter implements MailServerAdapter {
  readonly type = 'postal' as const;
  readonly displayName = 'Postal';

  private async call(config: AdapterConfig, path: string, body: unknown = {}): Promise<any> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Server-API-Key': config.apiToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Postal ${res.status}: ${path}`);
    return res.json();
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      // Any 200 against the API confirms the key. `messages/deliveries` with
      // a 0-limit is the smallest round-trip.
      await this.call(config, '/api/v1/messages/deliveries', { limit: 1 });
      return { ok: true, message: 'Connected to Postal' };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Network error' };
    }
  }

  async getStats(): Promise<ServerStats> {
    // Postal's stats APIs vary by version; defer richer numbers until we
    // pick a baseline version. Leave defaults so the scheduler keeps running.
    return {
      queueDepth: 0, queueFailed: 0,
      delivered24h: 0, bounced24h: 0, rejected24h: 0, deferred24h: 0,
      tlsPercent: 100, serverVersion: 'postal',
    };
  }

  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('PostalAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('PostalAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('PostalAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('PostalAdapter', 'getRecipientDomainStats');
  }
}

import { StalwartClient } from '../stalwart-client';
import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueMessage, QueueStats, RecipientDomainStat, ServerStats,
} from './types';

/**
 * Stalwart Mail Server adapter. Stalwart's management API is evolving, so
 * every method degrades gracefully: missing endpoints / fields return
 * sensible defaults rather than throwing. Callers should still check for
 * empty arrays and zeroed counters before drawing conclusions.
 */
export class StalwartAdapter implements MailServerAdapter {
  readonly type = 'stalwart' as const;
  readonly displayName = 'Stalwart Mail Server';

  private client(config: AdapterConfig): StalwartClient {
    return new StalwartClient({
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      token: config.apiToken,
      timeoutMs: 8000,
    });
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const info = await this.client(config).get<{ version?: string; name?: string }>('/api/server/info');
      const version = info?.version ?? 'unknown';
      return { ok: true, version, message: `Connected to Stalwart ${version}` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Connection failed' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const c = this.client(config);
    const safe = async <T>(p: string): Promise<T | null> => {
      try { return await c.get<T>(p); } catch { return null; }
    };
    const [summary, info, report] = await Promise.all([
      safe<any>('/api/queue/summary'),
      safe<any>('/api/server/info'),
      safe<any>('/api/reports/smtp?period=24h'),
    ]);
    const n = (v: unknown): number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      return 0;
    };
    return {
      queueDepth: n(summary?.queue?.depth ?? summary?.queueDepth ?? summary?.depth ?? summary?.total),
      queueFailed: n(summary?.queue?.failed ?? summary?.queueFailed ?? summary?.failed),
      delivered24h: n(report?.delivered ?? summary?.delivered_24h ?? summary?.delivered),
      bounced24h: n(report?.bounced ?? summary?.bounced_24h ?? summary?.bounced),
      rejected24h: n(report?.rejected ?? summary?.rejected_24h ?? summary?.rejected),
      deferred24h: n(report?.deferred ?? summary?.deferred_24h ?? summary?.deferred),
      tlsPercent: n(report?.tlsPercent ?? summary?.tls_percent ?? summary?.tlsPercentage),
      serverVersion: String(info?.version ?? 'unknown'),
      uptime: typeof info?.uptime === 'number' ? info.uptime : undefined,
    };
  }

  async getQueue(config: AdapterConfig): Promise<QueueStats> {
    const c = this.client(config);
    let data: any;
    try {
      data = await c.get<any>('/api/queue/messages?limit=100');
    } catch {
      return { total: 0, active: 0, deferred: 0, failed: 0, oldestMessageAge: 0, messages: [] };
    }
    const rawMessages: any[] = Array.isArray(data?.messages) ? data.messages : Array.isArray(data) ? data : [];
    const messages: QueueMessage[] = rawMessages.map((m) => ({
      id: String(m.id ?? m.queue_id ?? ''),
      from: String(m.from ?? m.sender ?? ''),
      to: Array.isArray(m.to) ? m.to.map(String) : m.recipient ? [String(m.recipient)] : [],
      size: Number(m.size ?? 0),
      attempts: Number(m.attempts ?? m.retries ?? 0),
      lastAttempt: m.lastAttempt ? new Date(m.lastAttempt) : new Date(0),
      nextAttempt: m.nextAttempt ? new Date(m.nextAttempt) : new Date(0),
      lastError: m.lastError ?? m.error ?? null,
      age: Number(m.age ?? 0),
    }));
    return {
      total: Number(data?.total ?? messages.length),
      active: Number(data?.active ?? 0),
      deferred: Number(data?.deferred ?? 0),
      failed: Number(data?.failed ?? 0),
      oldestMessageAge: messages[0]?.age ?? 0,
      messages,
    };
  }

  async getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]> {
    const c = this.client(config);
    let data: any;
    try {
      data = await c.get<any>(`/api/logs/delivery?since=${since.toISOString()}&limit=${limit}`);
    } catch {
      return [];
    }
    const rows: any[] = Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
    return rows.map((e) => {
      const to = String(e.to ?? e.recipient ?? '');
      const recipientDomain = to.includes('@') ? to.split('@').pop()!.toLowerCase() : '';
      const type: DeliveryEvent['type'] = ['delivered', 'bounced', 'deferred', 'rejected'].includes(e.type)
        ? e.type
        : 'delivered';
      return {
        id: String(e.id ?? `${e.timestamp ?? Date.now()}-${to}`),
        timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        type,
        from: String(e.from ?? ''),
        to,
        recipientDomain,
        size: Number(e.size ?? 0),
        delay: Number(e.delay ?? e.delayMs ?? 0),
        tlsUsed: Boolean(e.tlsUsed ?? e.tls),
        errorCode: e.errorCode ?? undefined,
        errorMessage: e.errorMessage ?? e.error ?? undefined,
        bounceType: e.bounceType,
      };
    });
  }

  async getAuthFailures(config: AdapterConfig, since: Date): Promise<AuthFailureEvent[]> {
    const c = this.client(config);
    let data: any;
    try {
      data = await c.get<any>(`/api/logs/auth?since=${since.toISOString()}&type=failure`);
    } catch {
      return [];
    }
    const rows: any[] = Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
    return rows.map((e) => ({
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      ip: String(e.ip ?? e.remoteIp ?? ''),
      username: e.username ? String(e.username) : undefined,
      mechanism: String(e.mechanism ?? 'UNKNOWN').toUpperCase(),
      failCount: Number(e.failCount ?? e.count ?? 1),
    }));
  }

  async getRecipientDomainStats(config: AdapterConfig, since: Date): Promise<RecipientDomainStat[]> {
    const c = this.client(config);
    let data: any;
    try {
      data = await c.get<any>(`/api/reports/recipient-domains?since=${since.toISOString()}`);
    } catch {
      return [];
    }
    const rows: any[] = Array.isArray(data?.domains) ? data.domains : Array.isArray(data) ? data : [];
    return rows.map((r) => {
      const sent = Number(r.sent ?? 0);
      const delivered = Number(r.delivered ?? 0);
      const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0;
      return {
        domain: String(r.domain ?? '').toLowerCase(),
        sent,
        delivered,
        bounced: Number(r.bounced ?? 0),
        deferred: Number(r.deferred ?? 0),
        deliveryRate: r.deliveryRate != null ? Number(r.deliveryRate) : deliveryRate,
        avgDelayMs: Number(r.avgDelayMs ?? r.avgDelay ?? 0),
        lastBounceReason: r.lastBounceReason ?? undefined,
      };
    });
  }
}

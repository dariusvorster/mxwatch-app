import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueMessage, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { PostfixLogParser, parsePostfixTimestamp } from './postfix-log-parser';

/**
 * Mailcow adapter. Mailcow wraps Postfix + Dovecot in containers and exposes
 * a REST API secured by X-API-Key. Delivery events come from Postfix logs
 * (parsed with the shared PostfixLogParser); auth failures come from Dovecot
 * logs.
 */
export class MailcowAdapter implements MailServerAdapter {
  readonly type = 'mailcow' as const;
  readonly displayName = 'Mailcow';

  private async get<T>(config: AdapterConfig, path: string, timeoutMs = 8000): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
      const res = await fetch(url, {
        headers: { 'X-API-Key': config.apiToken, Accept: 'application/json' },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Mailcow API ${res.status}: ${path}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    try {
      const status = await this.get<any>(config, '/api/v1/get/status/containers');
      const postfixRunning = status?.['postfix-mailcow']?.state === 'running' || status?.postfix?.state === 'running';
      const version = status?.['mailcow_dockerized']?.version ?? status?.mailcow?.version;
      return {
        ok: Boolean(postfixRunning),
        version: version ? String(version) : undefined,
        message: postfixRunning ? 'Connected to Mailcow' : 'Postfix container not running',
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Connection failed' };
    }
  }

  async getStats(config: AdapterConfig): Promise<ServerStats> {
    const safe = async <T>(p: string): Promise<T | null> => {
      try { return await this.get<T>(config, p); } catch { return null; }
    };
    const [containers, logs, vmail] = await Promise.all([
      safe<any>('/api/v1/get/status/containers'),
      safe<string[] | any[]>('/api/v1/get/logs/postfix/1000'),
      safe<any>('/api/v1/get/status/vmail'),
    ]);
    const logLines = normaliseLogLines(logs);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const events = PostfixLogParser.parse(logLines, since);
    const delivered = events.filter((e) => e.type === 'delivered').length;
    const bounced = events.filter((e) => e.type === 'bounced').length;
    const deferred = events.filter((e) => e.type === 'deferred').length;
    const rejected = events.filter((e) => e.type === 'rejected').length;
    const tlsPercent = events.length > 0
      ? Math.round((events.filter((e) => e.tlsUsed).length / events.length) * 100)
      : 0;

    const queue = await this.fetchQueue(config).catch(() => null);

    return {
      queueDepth: queue?.total ?? 0,
      queueFailed: queue?.failed ?? 0,
      delivered24h: delivered,
      bounced24h: bounced,
      rejected24h: rejected,
      deferred24h: deferred,
      tlsPercent,
      serverVersion: String(containers?.['mailcow_dockerized']?.version ?? containers?.mailcow?.version ?? 'unknown'),
      uptime: typeof vmail?.uptime === 'number' ? vmail.uptime : undefined,
    };
  }

  private async fetchQueue(config: AdapterConfig): Promise<QueueStats> {
    const data = await this.get<any>(config, '/api/v1/get/mailq/all');
    const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    const messages: QueueMessage[] = rows.map((m) => ({
      id: String(m.queue_id ?? m.id ?? ''),
      from: String(m.sender ?? m.from ?? ''),
      to: Array.isArray(m.recipients) ? m.recipients.map(String) : m.recipient ? [String(m.recipient)] : [],
      size: Number(m.message_size ?? m.size ?? 0),
      attempts: Number(m.attempts ?? 0),
      lastAttempt: m.arrival_time ? new Date(Number(m.arrival_time) * 1000) : new Date(0),
      nextAttempt: new Date(0),
      lastError: m.reason ?? m.lastError ?? null,
      age: m.arrival_time ? Math.floor(Date.now() / 1000 - Number(m.arrival_time)) : 0,
    }));
    return {
      total: messages.length,
      active: 0,
      deferred: messages.filter((m) => !!m.lastError).length,
      failed: 0,
      oldestMessageAge: messages.reduce((max, m) => Math.max(max, m.age), 0),
      messages,
    };
  }

  async getQueue(config: AdapterConfig): Promise<QueueStats> {
    try { return await this.fetchQueue(config); }
    catch { return { total: 0, active: 0, deferred: 0, failed: 0, oldestMessageAge: 0, messages: [] }; }
  }

  async getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]> {
    const logs = await this.get<any>(config, `/api/v1/get/logs/postfix/${limit}`).catch(() => [] as any);
    return PostfixLogParser.parse(normaliseLogLines(logs), since);
  }

  async getAuthFailures(config: AdapterConfig, since: Date): Promise<AuthFailureEvent[]> {
    const logs = await this.get<any>(config, '/api/v1/get/logs/dovecot/500').catch(() => [] as any);
    return parseDovecotAuthFailures(normaliseLogLines(logs), since);
  }

  async getRecipientDomainStats(config: AdapterConfig, since: Date): Promise<RecipientDomainStat[]> {
    const events = await this.getDeliveryEvents(config, since, 5000);
    return PostfixLogParser.aggregateByDomain(events);
  }
}

/**
 * Mailcow returns log endpoints as either an array of strings or an array of
 * `{ time, message }` objects depending on version. Coerce to a flat string[].
 */
function normaliseLogLines(logs: unknown): string[] {
  if (!logs) return [];
  if (Array.isArray(logs)) {
    if (logs.length === 0) return [];
    if (typeof logs[0] === 'string') return logs as string[];
    return logs.map((row: any) => {
      if (row?.message && row?.time) {
        const ts = typeof row.time === 'number' ? new Date(row.time * 1000).toISOString() : row.time;
        return `${ts} ${row.message}`;
      }
      return row?.message ?? '';
    }).filter(Boolean);
  }
  if (typeof logs === 'string') return logs.split(/\r?\n/);
  return [];
}

// Dovecot auth failure lines, e.g.:
// Apr 14 10:30:00 mail dovecot: imap-login: Disconnected (auth failed, 2 attempts in 5 secs):
//   user=<foo>, method=PLAIN, rip=1.2.3.4, lip=10.0.0.1, TLS
export function parseDovecotAuthFailures(lines: string[], since: Date, now: Date = new Date()): AuthFailureEvent[] {
  const out: AuthFailureEvent[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!/auth failed/i.test(line)) continue;
    const ts = parsePostfixTimestamp(line, now);
    if (!ts || ts < since) continue;
    const ip = line.match(/\brip=([0-9a-f.:]+)/i)?.[1];
    if (!ip) continue;
    const user = line.match(/\buser=<?([^,>\s]+)>?/)?.[1];
    const method = line.match(/\bmethod=([A-Za-z0-9_-]+)/)?.[1]?.toUpperCase() ?? 'UNKNOWN';
    const attempts = Number(line.match(/(\d+)\s+attempts?/)?.[1] ?? 1);
    out.push({ timestamp: ts, ip, username: user, mechanism: method, failCount: attempts });
  }
  return out;
}

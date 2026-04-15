import type { DeliveryEvent, RecipientDomainStat } from './types';

// Postfix delivery log line, typical shape:
//   Apr 14 10:23:45 mail postfix/smtp[1234]: ABC123: to=<user@gmail.com>,
//     relay=..., delay=1.2, delays=..., dsn=2.0.0, status=sent (250 ...)
//
// Journald / rsyslog RFC3339 variant:
//   2026-04-14T10:23:45.123+00:00 mail postfix/smtp[1234]: ABC123: to=...

const STATUSES: Record<string, DeliveryEvent['type']> = {
  sent: 'delivered',
  bounced: 'bounced',
  deferred: 'deferred',
  rejected: 'rejected',
};

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parsePostfixTimestamp(line: string, now: Date = new Date()): Date | null {
  // ISO: 2026-04-14T10:23:45(.sss)?(Z|±HH:MM)
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)/);
  if (iso?.[1]) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Classic syslog: "Apr 14 10:23:45"
  const sys = line.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (sys && sys[1]) {
    const month = MONTHS[sys[1]];
    if (month == null) return null;
    const day = Number(sys[2]);
    const h = Number(sys[3]);
    const m = Number(sys[4]);
    const s = Number(sys[5]);
    let year = now.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, month, day, h, m, s));
    // Syslog has no year; if the parsed date is >24h in the future, assume
    // it belongs to the previous year (log-rollover case).
    if (candidate.getTime() - now.getTime() > 24 * 3600 * 1000) {
      candidate.setUTCFullYear(year - 1);
    }
    return candidate;
  }
  return null;
}

function extractField(line: string, key: string): string | null {
  // to=<user@example.com>
  const bracket = line.match(new RegExp(`\\b${key}=<([^>]+)>`));
  if (bracket?.[1]) return bracket[1];
  // delay=1.2, status=sent
  const plain = line.match(new RegExp(`\\b${key}=([^,\\s]+)`));
  return plain?.[1] ?? null;
}

function parseDeliveryLine(line: string, type: DeliveryEvent['type'], ts: Date): DeliveryEvent {
  const to = (extractField(line, 'to') ?? '').toLowerCase();
  const from = (extractField(line, 'from') ?? extractField(line, 'orig_to') ?? '').toLowerCase();
  const dsn = extractField(line, 'dsn');
  const delayStr = extractField(line, 'delay');
  const delay = delayStr ? Number(delayStr) * 1000 : 0;
  // status=bounced (reason text follows in parentheses)
  const paren = line.match(/status=\w+\s+\(([^)]+)\)/);
  const errorMessage = paren?.[1]?.trim();
  const sizeStr = extractField(line, 'size');
  const recipientDomain = to.includes('@') ? to.split('@').pop()!.toLowerCase() : '';
  const queueId = line.match(/postfix\/[^\]]+\]:\s+([A-F0-9]{6,}):/)?.[1];

  const bounceType: DeliveryEvent['bounceType'] | undefined =
    type === 'bounced' && dsn
      ? dsn.startsWith('5.') ? 'hard' : dsn.startsWith('4.') ? 'soft' : undefined
      : undefined;

  return {
    id: queueId ?? `${ts.getTime()}-${to}`,
    timestamp: ts,
    type,
    from,
    to,
    recipientDomain,
    size: sizeStr ? Number(sizeStr) : 0,
    delay: Number.isFinite(delay) ? delay : 0,
    tlsUsed: /\b(TLS|tlsv?\d)/i.test(line),
    errorCode: dsn ?? undefined,
    errorMessage,
    bounceType,
  };
}

export class PostfixLogParser {
  static parse(lines: string[], since: Date, now: Date = new Date()): DeliveryEvent[] {
    const events: DeliveryEvent[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const statusMatch = line.match(/\bstatus=([a-z]+)/);
      if (!statusMatch?.[1]) continue;
      const type = STATUSES[statusMatch[1]];
      if (!type) continue;
      const ts = parsePostfixTimestamp(line, now);
      if (!ts) continue;
      if (ts < since) continue;
      events.push(parseDeliveryLine(line, type, ts));
    }
    return events;
  }

  static aggregateByDomain(events: DeliveryEvent[]): RecipientDomainStat[] {
    const byDomain = new Map<string, RecipientDomainStat & { _delayTotal: number; _delayCount: number }>();
    for (const e of events) {
      const domain = e.recipientDomain;
      if (!domain) continue;
      let stat = byDomain.get(domain);
      if (!stat) {
        stat = {
          domain, sent: 0, delivered: 0, bounced: 0, deferred: 0,
          deliveryRate: 0, avgDelayMs: 0, _delayTotal: 0, _delayCount: 0,
        };
        byDomain.set(domain, stat);
      }
      stat.sent += 1;
      if (e.type === 'delivered') stat.delivered += 1;
      if (e.type === 'bounced') {
        stat.bounced += 1;
        if (e.errorMessage) stat.lastBounceReason = e.errorMessage;
      }
      if (e.type === 'deferred') stat.deferred += 1;
      if (e.delay > 0) {
        stat._delayTotal += e.delay;
        stat._delayCount += 1;
      }
    }
    const out: RecipientDomainStat[] = [];
    for (const s of byDomain.values()) {
      out.push({
        domain: s.domain,
        sent: s.sent,
        delivered: s.delivered,
        bounced: s.bounced,
        deferred: s.deferred,
        deliveryRate: s.sent > 0 ? Math.round((s.delivered / s.sent) * 1000) / 10 : 0,
        avgDelayMs: s._delayCount > 0 ? Math.round(s._delayTotal / s._delayCount) : 0,
        lastBounceReason: s.lastBounceReason,
      });
    }
    return out.sort((a, b) => b.sent - a.sent);
  }
}

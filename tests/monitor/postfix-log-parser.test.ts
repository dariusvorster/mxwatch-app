import { describe, it, expect } from 'vitest';
import { PostfixLogParser, parsePostfixTimestamp } from '@mxwatch/monitor';

const NOW = new Date('2026-04-14T12:00:00Z');
const SINCE = new Date('2026-04-14T00:00:00Z');

const sentLine =
  'Apr 14 10:23:45 mail postfix/smtp[1234]: ABC123F: to=<user@gmail.com>, relay=gmail-smtp-in.l.google.com[142.250.27.27]:25, delay=1.2, delays=0.1/0/0.5/0.6, dsn=2.0.0, status=sent (250 2.0.0 OK)';

const bouncedLine =
  'Apr 14 10:25:00 mail postfix/smtp[1235]: DEF456A: to=<someone@yahoo.com>, relay=mta.am0.yahoodns.net[98.137.11.164]:25, delay=0.5, dsn=5.7.1, status=bounced (host mta.am0.yahoodns.net[98.137.11.164] said: 554 5.7.1 message rejected)';

const deferredLine =
  'Apr 14 10:30:00 mail postfix/smtp[1236]: GHI789B: to=<x@slow.example>, delay=40, dsn=4.4.1, status=deferred (connect timeout)';

const isoLine =
  '2026-04-14T10:40:00.123Z mail postfix/smtp[1237]: JKL000C: to=<a@outlook.com>, delay=0.8, dsn=2.0.0, status=sent (250 ok)';

describe('parsePostfixTimestamp', () => {
  it('parses syslog form with assumed current year', () => {
    const d = parsePostfixTimestamp(sentLine, NOW);
    expect(d?.toISOString()).toBe('2026-04-14T10:23:45.000Z');
  });

  it('rolls back a year when the syslog date is >24h in the future', () => {
    const early = new Date('2026-01-02T00:00:00Z');
    const d = parsePostfixTimestamp('Dec 31 23:59:00 mail postfix: X: status=sent', early);
    expect(d?.getUTCFullYear()).toBe(2025);
  });

  it('parses ISO-prefixed journal lines', () => {
    const d = parsePostfixTimestamp(isoLine, NOW);
    expect(d?.toISOString()).toBe('2026-04-14T10:40:00.123Z');
  });
});

describe('PostfixLogParser.parse', () => {
  it('classifies sent/bounced/deferred and skips garbage', () => {
    const events = PostfixLogParser.parse(
      [sentLine, bouncedLine, deferredLine, 'noise', ''],
      SINCE,
      NOW,
    );
    expect(events.map((e) => e.type)).toEqual(['delivered', 'bounced', 'deferred']);
    expect(events[1].recipientDomain).toBe('yahoo.com');
    expect(events[1].bounceType).toBe('hard');
    expect(events[2].bounceType).toBeUndefined();
    expect(events[0].delay).toBe(1200);
  });

  it('ignores events older than `since`', () => {
    const future = new Date('2026-04-14T23:00:00Z');
    const events = PostfixLogParser.parse([sentLine], future, NOW);
    expect(events).toHaveLength(0);
  });
});

describe('PostfixLogParser.aggregateByDomain', () => {
  it('groups by recipient domain and computes delivery rate + avg delay', () => {
    const events = PostfixLogParser.parse(
      [sentLine, bouncedLine, deferredLine, isoLine],
      SINCE,
      NOW,
    );
    const agg = PostfixLogParser.aggregateByDomain(events);
    const gmail = agg.find((r) => r.domain === 'gmail.com')!;
    expect(gmail).toMatchObject({ sent: 1, delivered: 1, deliveryRate: 100 });
    const yahoo = agg.find((r) => r.domain === 'yahoo.com')!;
    expect(yahoo.bounced).toBe(1);
    expect(yahoo.lastBounceReason).toMatch(/554/);
    expect(agg[0].sent).toBeGreaterThanOrEqual(agg[agg.length - 1].sent);
  });
});

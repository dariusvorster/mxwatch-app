import { describe, it, expect } from 'vitest';
import { normalizeStalwartEvent, parseStalwartBody } from '../../packages/monitor/src/stalwart-parser';

describe('normalizeStalwartEvent', () => {
  it('extracts common Stalwart fields', () => {
    const n = normalizeStalwartEvent({
      '@timestamp': '2026-04-13T10:00:00Z',
      event: 'delivery.success',
      'span.from': 'me@example.com',
      'span.to': 'them@gmail.com',
      'span.remote.ip': '1.2.3.4',
      code: '250',
      message: 'OK',
    });
    expect(n).not.toBeNull();
    expect(n!.eventType).toBe('delivery.success');
    expect(n!.direction).toBe('outbound');
    expect(n!.senderAddress).toBe('me@example.com');
    expect(n!.remoteIp).toBe('1.2.3.4');
    expect(n!.resultCode).toBe('250');
    expect(n!.eventTime?.toISOString()).toBe('2026-04-13T10:00:00.000Z');
  });

  it('classifies auth events', () => {
    const n = normalizeStalwartEvent({ event: 'auth.success', ip: '1.2.3.4' });
    expect(n!.direction).toBe('auth');
  });

  it('falls back to other for unknown events', () => {
    const n = normalizeStalwartEvent({ event: 'something.weird' });
    expect(n!.direction).toBe('other');
  });

  it('returns null for non-object input', () => {
    expect(normalizeStalwartEvent('string')).toBeNull();
    expect(normalizeStalwartEvent(null)).toBeNull();
  });
});

describe('parseStalwartBody', () => {
  it('parses a single JSON object', () => {
    const events = parseStalwartBody('{"event":"smtp.connect","ip":"1.2.3.4"}');
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe('inbound');
  });

  it('parses NDJSON', () => {
    const body = [
      '{"event":"delivery.success","span.remote.ip":"1.1.1.1"}',
      '{"event":"auth.failure","ip":"2.2.2.2"}',
      '',
      '{"event":"smtp.connect","ip":"3.3.3.3"}',
    ].join('\n');
    const events = parseStalwartBody(body);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.direction)).toEqual(['outbound', 'auth', 'inbound']);
  });

  it('parses a JSON array', () => {
    const body = JSON.stringify([
      { event: 'delivery.success', ip: '1.1.1.1' },
      { event: 'queue.add', ip: '2.2.2.2' },
    ]);
    const events = parseStalwartBody(body);
    expect(events).toHaveLength(2);
  });

  it('skips malformed lines', () => {
    const body = '{"event":"ok"}\nnot json\n{"event":"auth.bad"}';
    const events = parseStalwartBody(body);
    expect(events).toHaveLength(2);
  });

  it('returns [] for empty body', () => {
    expect(parseStalwartBody('')).toEqual([]);
    expect(parseStalwartBody('   \n  ')).toEqual([]);
  });
});

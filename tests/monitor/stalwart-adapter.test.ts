import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalwartAdapter } from '@mxwatch/monitor';
import { StalwartClient } from '@mxwatch/monitor';

const config = { baseUrl: 'https://mail.example', apiToken: 't' };

function stubGet(responses: Record<string, any>) {
  return vi.spyOn(StalwartClient.prototype, 'get').mockImplementation(async (path: string) => {
    for (const [prefix, body] of Object.entries(responses)) {
      if (path.startsWith(prefix)) {
        if (body instanceof Error) throw body;
        return body;
      }
    }
    throw new Error(`404 Not Found ${path}`);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('StalwartAdapter.test', () => {
  it('returns ok with version on /api/server/info success', async () => {
    stubGet({ '/api/server/info': { version: '0.11.3' } });
    const res = await new StalwartAdapter().test(config);
    expect(res).toMatchObject({ ok: true, version: '0.11.3' });
  });

  it('returns ok=false when /api/server/info errors', async () => {
    stubGet({ '/api/server/info': new Error('connect ECONNREFUSED') });
    const res = await new StalwartAdapter().test(config);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/ECONNREFUSED/);
  });
});

describe('StalwartAdapter.getStats', () => {
  it('merges queue summary + info + smtp report with defensive defaults', async () => {
    stubGet({
      '/api/queue/summary': { queue: { depth: 7, failed: 1 } },
      '/api/server/info': { version: '0.11.3', uptime: 1234 },
      '/api/reports/smtp': { delivered: 100, bounced: 2, rejected: 1, deferred: 3, tlsPercent: 95 },
    });
    const stats = await new StalwartAdapter().getStats(config);
    expect(stats).toEqual({
      queueDepth: 7, queueFailed: 1,
      delivered24h: 100, bounced24h: 2, rejected24h: 1, deferred24h: 3,
      tlsPercent: 95, serverVersion: '0.11.3', uptime: 1234,
    });
  });

  it('returns zeroed stats when every endpoint 404s', async () => {
    stubGet({});
    const stats = await new StalwartAdapter().getStats(config);
    expect(stats.delivered24h).toBe(0);
    expect(stats.queueDepth).toBe(0);
    expect(stats.serverVersion).toBe('unknown');
  });
});

describe('StalwartAdapter.getRecipientDomainStats', () => {
  it('computes delivery rate when not supplied', async () => {
    stubGet({
      '/api/reports/recipient-domains': {
        domains: [{ domain: 'GMAIL.COM', sent: 100, delivered: 95, bounced: 5, deferred: 0 }],
      },
    });
    const out = await new StalwartAdapter().getRecipientDomainStats(config, new Date());
    expect(out[0]).toMatchObject({ domain: 'gmail.com', deliveryRate: 95 });
  });
});

describe('StalwartAdapter.getDeliveryEvents', () => {
  it('extracts recipient domain and normalises type', async () => {
    stubGet({
      '/api/logs/delivery': {
        events: [
          { id: '1', timestamp: '2026-04-14T00:00:00Z', type: 'bounced', to: 'user@OUTLOOK.com', from: 'a@x' },
          { id: '2', type: 'garbage', to: 'x@y.com' },
        ],
      },
    });
    const out = await new StalwartAdapter().getDeliveryEvents(config, new Date(0), 100);
    expect(out[0]).toMatchObject({ recipientDomain: 'outlook.com', type: 'bounced' });
    expect(out[1].type).toBe('delivered'); // unknown → default
  });
});

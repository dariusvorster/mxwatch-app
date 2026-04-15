import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResendAdapter, MailgunAdapter, SendGridAdapter, PostmarkAdapter } from '@mxwatch/monitor';

const config = { baseUrl: '', apiToken: 'k-abc' };

function stubFetch(handler: (url: string, init?: any) => { status?: number; body: any }) {
  return vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    const res = handler(String(url), init);
    const status = res.status ?? 200;
    return new Response(JSON.stringify(res.body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ResendAdapter', () => {
  it('test() reports domain count on 200', async () => {
    stubFetch(() => ({ body: { data: [{ id: '1' }, { id: '2' }] } }));
    const r = await new ResendAdapter().test(config);
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/2 domain/) });
  });

  it('test() bubbles up provider message on 401', async () => {
    stubFetch(() => ({ status: 401, body: { message: 'bad key' } }));
    const r = await new ResendAdapter().test(config);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/bad key/);
  });

  it('getStats() aggregates 24h counts by last_event', async () => {
    const now = Date.now();
    stubFetch(() => ({
      body: {
        data: [
          { created_at: new Date(now - 3600_000).toISOString(), last_event: 'delivered' },
          { created_at: new Date(now - 7200_000).toISOString(), last_event: 'delivered' },
          { created_at: new Date(now - 10800_000).toISOString(), last_event: 'bounced' },
          { created_at: new Date(now - 3 * 86400_000).toISOString(), last_event: 'delivered' }, // older than 24h
        ],
      },
    }));
    const s = await new ResendAdapter().getStats(config);
    expect(s.delivered24h).toBe(2);
    expect(s.bounced24h).toBe(1);
  });

  it('getDeliveryEvents() extracts recipient domain + maps last_event', async () => {
    const now = Date.now();
    stubFetch(() => ({
      body: {
        data: [
          { id: '1', created_at: new Date(now).toISOString(), last_event: 'bounced', to: ['user@EXAMPLE.com'], from: 's@x.com' },
        ],
      },
    }));
    const out = await new ResendAdapter().getDeliveryEvents(config, new Date(now - 3600_000), 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ recipientDomain: 'example.com', type: 'bounced' });
  });
});

describe('MailgunAdapter', () => {
  const cfg = { baseUrl: '', apiToken: 'k', extras: { domain: 'example.com', region: 'us' } };

  it('test() requires extras.domain', async () => {
    const r = await new MailgunAdapter().test({ ...cfg, extras: {} });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/extras.domain/);
  });

  it('getStats() sums delivered / failed(temp|perm) totals', async () => {
    stubFetch((url) => {
      expect(url).toContain('api.mailgun.net');
      return {
        body: {
          stats: [
            { delivered: { total: 10 }, failed: { permanent: 2, temporary: 1 }, rejected: { total: 1 } },
            { delivered: { total: 5 }, failed: { permanent: 0, temporary: 0 }, rejected: { total: 0 } },
          ],
        },
      };
    });
    const s = await new MailgunAdapter().getStats(cfg);
    expect(s.delivered24h).toBe(15);
    expect(s.bounced24h).toBe(2);
    expect(s.deferred24h).toBe(1);
    expect(s.rejected24h).toBe(1);
  });

  it('getStats() picks EU endpoint when region=eu', async () => {
    let seenUrl = '';
    stubFetch((url) => { seenUrl = url; return { body: { stats: [] } }; });
    await new MailgunAdapter().getStats({ ...cfg, extras: { domain: 'example.com', region: 'eu' } });
    expect(seenUrl).toContain('api.eu.mailgun.net');
  });
});

describe('SendGridAdapter', () => {
  it('getStats() reads metrics from the first populated date row', async () => {
    stubFetch(() => ({
      body: [
        { stats: [{ metrics: { delivered: 42, bounces: 3, deferred: 1, blocks: 2 } }] },
      ],
    }));
    const s = await new SendGridAdapter().getStats(config);
    expect(s).toMatchObject({ delivered24h: 42, bounced24h: 3, deferred24h: 1, rejected24h: 2 });
  });
});

describe('PostmarkAdapter', () => {
  it('test() returns server name on 200', async () => {
    stubFetch(() => ({ body: { Name: 'Broadcasts', DeliveryType: 'Live' } }));
    const r = await new PostmarkAdapter().test(config);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Broadcasts/);
  });

  it('getStats() maps Postmark stats.outbound fields', async () => {
    stubFetch(() => ({ body: { Sent: 100, Bounced: 5, Deferred: 2, SMTPApiErrors: 1 } }));
    const s = await new PostmarkAdapter().getStats(config);
    expect(s).toMatchObject({ delivered24h: 100, bounced24h: 5, deferred24h: 2, rejected24h: 1 });
  });
});

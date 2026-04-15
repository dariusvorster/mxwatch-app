import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MailcowAdapter, PostfixAdapter, parseDovecotAuthFailures } from '@mxwatch/monitor';

const config = { baseUrl: 'https://mail.example', apiToken: 'k' };
let realFetch: typeof fetch;

function stub(handler: (url: string) => { status?: number; body: any }) {
  return vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const res = handler(String(url));
    const status = res.status ?? 200;
    return new Response(JSON.stringify(res.body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}

beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });

describe('MailcowAdapter.test', () => {
  it('ok=true when postfix container is running', async () => {
    stub(() => ({ body: { 'postfix-mailcow': { state: 'running' }, mailcow_dockerized: { version: '2025-10' } } }));
    const res = await new MailcowAdapter().test(config);
    expect(res).toMatchObject({ ok: true, version: '2025-10' });
  });

  it('ok=false when postfix is stopped', async () => {
    stub(() => ({ body: { 'postfix-mailcow': { state: 'exited' } } }));
    const res = await new MailcowAdapter().test(config);
    expect(res.ok).toBe(false);
  });

  it('ok=false on HTTP error', async () => {
    stub(() => ({ status: 401, body: { error: 'bad key' } }));
    const res = await new MailcowAdapter().test(config);
    expect(res.ok).toBe(false);
  });
});

describe('MailcowAdapter.getDeliveryEvents', () => {
  it('reuses PostfixLogParser against raw log strings', async () => {
    const now = new Date();
    const lines = [
      `${new Date(now.getTime() - 60_000).toISOString().replace(/\.\d+Z$/, 'Z')} mail postfix/smtp[1]: A1: to=<u@gmail.com>, delay=1, dsn=2.0.0, status=sent (250 ok)`,
    ];
    stub((url) => {
      if (url.includes('/api/v1/get/logs/postfix/')) return { body: lines };
      return { body: {} };
    });
    const out = await new MailcowAdapter().getDeliveryEvents(config, new Date(now.getTime() - 5 * 60_000), 100);
    expect(out).toHaveLength(1);
    expect(out[0].recipientDomain).toBe('gmail.com');
  });
});

describe('parseDovecotAuthFailures', () => {
  it('extracts IP/user/mechanism/attempts for "auth failed" lines', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    const since = new Date('2026-04-14T00:00:00Z');
    const lines = [
      'Apr 14 10:30:00 mail dovecot: imap-login: Disconnected (auth failed, 3 attempts in 8 secs): user=<victim@example.com>, method=PLAIN, rip=45.67.89.10, TLS',
      'Apr 14 10:31:00 mail dovecot: imap-login: login OK: user=<ok@example.com>',
    ];
    const out = parseDovecotAuthFailures(lines, since, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ip: '45.67.89.10', username: 'victim@example.com', mechanism: 'PLAIN', failCount: 3,
    });
  });
});

describe('PostfixAdapter stub', () => {
  it('test() surfaces the "agent required" message', async () => {
    const res = await new PostfixAdapter().test(config);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/agent/);
  });

  it('getStats() throws AdapterUnsupportedError', async () => {
    await expect(new PostfixAdapter().getStats(config)).rejects.toThrow(/does not support/);
  });
});

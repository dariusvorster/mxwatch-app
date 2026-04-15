import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns';
import {
  checkSingleRBL, hasAutoExpired, draftDelistRequest, RBL_KNOWLEDGE, rblKeyForDisplayName,
} from '@mxwatch/monitor';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('hasAutoExpired', () => {
  it('false when the RBL does not auto-expire', () => {
    expect(hasAutoExpired('spamhaus-zen', new Date(0))).toBe(false);
  });

  it('false when submittedAt is null', () => {
    expect(hasAutoExpired('spamcop', null)).toBe(false);
  });

  it('true when elapsed time beats the auto-expire window', () => {
    // SpamCop = 24h
    const submittedAt = new Date(Date.now() - 25 * 3600 * 1000);
    expect(hasAutoExpired('spamcop', submittedAt)).toBe(true);
  });

  it('false when still within the window', () => {
    const submittedAt = new Date(Date.now() - 12 * 3600 * 1000);
    expect(hasAutoExpired('spamcop', submittedAt)).toBe(false);
  });
});

describe('checkSingleRBL', () => {
  it('returns listed=true when DNS resolves to any address', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['127.0.0.2']);
    const r = await checkSingleRBL({ value: '1.2.3.4', rblHost: 'zen.spamhaus.org', type: 'ip' });
    expect(r).toEqual({ listed: true });
  });

  it('returns listed=false on ENOTFOUND (not listed)', async () => {
    const err: any = new Error('nx'); err.code = 'ENOTFOUND';
    vi.spyOn(dns.promises, 'resolve4').mockRejectedValue(err);
    const r = await checkSingleRBL({ value: '1.2.3.4', rblHost: 'zen.spamhaus.org', type: 'ip' });
    expect(r).toEqual({ listed: false });
  });

  it('reverses IPv4 octets in the query name', async () => {
    const spy = vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['127.0.0.5']);
    await checkSingleRBL({ value: '1.2.3.4', rblHost: 'bl.example.com', type: 'ip' });
    expect(spy).toHaveBeenCalledWith('4.3.2.1.bl.example.com');
  });

  it('uses domain directly for domain-type lookups', async () => {
    const spy = vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['127.0.0.5']);
    await checkSingleRBL({ value: 'example.com', rblHost: 'dbl.spamhaus.org', type: 'domain' });
    expect(spy).toHaveBeenCalledWith('example.com.dbl.spamhaus.org');
  });
});

describe('RBL_KNOWLEDGE coverage', () => {
  it('display-name map entries all resolve to known knowledge-base keys', () => {
    const displayNames = [
      'Spamhaus ZEN', 'Spamhaus PBL', 'Spamhaus SBL', 'Spamhaus DBL',
      'Barracuda BRBL', 'SORBS DUHL', 'SORBS SPAM', 'Invaluement ivmSIP',
      'SpamCop', 'Spamrats', 'Mailspike', 'SEM-BACKSCATTER', 'URIBL', 'Microsoft SNDS',
    ];
    for (const name of displayNames) {
      const key = rblKeyForDisplayName(name);
      expect(key, `no key mapping for ${name}`).not.toBeNull();
      expect(RBL_KNOWLEDGE[key!], `no knowledge entry for ${key}`).toBeTruthy();
    }
  });
});

describe('draftDelistRequest', () => {
  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(draftDelistRequest({
        rblName: 'spamhaus-zen',
        domain: 'example.com',
        listedValue: '1.2.3.4',
        serverInfo: {},
      })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('posts to Anthropic and returns the text block', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchSpy = vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ content: [{ text: 'Dear Spamhaus,\n\nPlease remove 1.2.3.4.' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));
    const out = await draftDelistRequest({
      rblName: 'spamhaus-zen',
      domain: 'example.com',
      listedValue: '1.2.3.4',
      serverInfo: { spfStatus: 'pass', dmarcPolicy: 'reject' },
    });
    expect(out).toMatch(/Spamhaus/);
    expect(out).toMatch(/1\.2\.3\.4/);
    expect(fetchSpy).toBeDefined();
  });

  it('surfaces Anthropic error bodies', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"message":"overloaded"}}', { status: 529 },
    )));
    await expect(draftDelistRequest({
      rblName: 'spamhaus-zen',
      domain: 'example.com',
      listedValue: '1.2.3.4',
      serverInfo: {},
    })).rejects.toThrow(/529/);
  });

  it('throws on unknown RBL name', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await expect(draftDelistRequest({
      rblName: 'not-a-real-rbl',
      domain: 'example.com',
      listedValue: '1.2.3.4',
      serverInfo: {},
    })).rejects.toThrow(/Unknown RBL/);
  });
});

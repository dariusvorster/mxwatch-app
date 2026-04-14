import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import dns from 'node:dns';
import { BLACKLISTS, checkIpAgainstBlacklist, checkIpAgainstAllBlacklists } from '../../packages/monitor/src/blacklists';

let spy: MockInstance<typeof dns.promises.resolve4>;

beforeEach(() => { spy = vi.spyOn(dns.promises, 'resolve4'); });
afterEach(() => { spy.mockRestore(); });

describe('checkIpAgainstBlacklist', () => {
  it('builds reversed-IP lookup and reports listed on resolve4 success', async () => {
    spy.mockImplementation(async (host: string) => {
      expect(host).toBe('4.3.2.1.zen.spamhaus.org');
      return ['127.0.0.2'];
    });
    const r = await checkIpAgainstBlacklist('1.2.3.4', BLACKLISTS[0]);
    expect(r.listed).toBe(true);
    expect(r.blacklist).toBe('Spamhaus ZEN');
  });

  it('reports not-listed on NXDOMAIN', async () => {
    spy.mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkIpAgainstBlacklist('1.2.3.4', BLACKLISTS[0]);
    expect(r.listed).toBe(false);
  });
});

describe('checkIpAgainstAllBlacklists', () => {
  it('aggregates listings across the full RBL suite', async () => {
    spy.mockImplementation(async (host: string) => {
      if (host.endsWith('.zen.spamhaus.org') || host.endsWith('.bl.spamcop.net')) return ['127.0.0.2'];
      throw new Error('ENOTFOUND');
    });
    const r = await checkIpAgainstAllBlacklists('127.0.0.2');
    expect(r.isListed).toBe(true);
    expect(r.listedOn).toEqual(expect.arrayContaining(['Spamhaus ZEN', 'SpamCop']));
  });

  it('returns clean when nothing resolves', async () => {
    spy.mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkIpAgainstAllBlacklists('8.8.8.8');
    expect(r.isListed).toBe(false);
    expect(r.listedOn).toEqual([]);
  });
});

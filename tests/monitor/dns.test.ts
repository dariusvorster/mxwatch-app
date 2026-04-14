import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTxt: vi.fn(),
  resolveMx: vi.fn(),
}));

vi.mock('node:dns', () => ({
  default: { promises: { resolveTxt: mocks.resolveTxt, resolveMx: mocks.resolveMx, resolve4: vi.fn() } },
}));

import { checkSpf, checkDkim, checkDmarc, checkMx, calculateHealthScore, countSpfLookups } from '../../packages/monitor/src/dns';

beforeEach(() => {
  mocks.resolveTxt.mockReset();
  mocks.resolveMx.mockReset();
});

describe('countSpfLookups', () => {
  it('counts include, a, mx, ptr, exists, redirect mechanisms', () => {
    const spf = 'v=spf1 include:_spf.google.com include:mailgun.org a mx ptr exists:%{l}._spf.example.com redirect=_spf.example.com -all';
    expect(countSpfLookups(spf)).toBe(7);
  });
  it('returns 0 for bare -all', () => {
    expect(countSpfLookups('v=spf1 -all')).toBe(0);
  });
});

describe('checkSpf', () => {
  it('flags no-record when TXT lookup fails', async () => {
    mocks.resolveTxt.mockRejectedValue(new Error('ENODATA'));
    const r = await checkSpf('example.com');
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('No SPF record found');
  });

  it('flags +all and missing qualifier', async () => {
    mocks.resolveTxt.mockResolvedValue([['v=spf1 include:foo.com +all']]);
    const r = await checkSpf('example.com');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('+all'))).toBe(true);
  });

  it('accepts a clean record with -all', async () => {
    mocks.resolveTxt.mockResolvedValue([['v=spf1 mx -all']]);
    const r = await checkSpf('example.com');
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags >10 lookups', async () => {
    const manyIncludes = Array.from({ length: 11 }, (_, i) => `include:s${i}.example.com`).join(' ');
    mocks.resolveTxt.mockResolvedValue([[`v=spf1 ${manyIncludes} ~all`]]);
    const r = await checkSpf('example.com');
    expect(r.issues.some((i) => i.includes('10 DNS lookup'))).toBe(true);
  });
});

describe('checkDkim', () => {
  it('returns missing when selector not found', async () => {
    mocks.resolveTxt.mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkDkim('example.com', 'mail');
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/DKIM selector/);
  });

  it('accepts a 2048-bit key', async () => {
    // 256-byte base64 ≈ 2048 bits
    const p = Buffer.alloc(256, 1).toString('base64');
    mocks.resolveTxt.mockResolvedValue([[`v=DKIM1; k=rsa; p=${p}`]]);
    const r = await checkDkim('example.com', 'mail');
    expect(r.valid).toBe(true);
  });

  it('warns on short keys', async () => {
    const p = Buffer.alloc(64, 1).toString('base64'); // ~512 bits
    mocks.resolveTxt.mockResolvedValue([[`v=DKIM1; k=rsa; p=${p}`]]);
    const r = await checkDkim('example.com', 'mail');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('too short'))).toBe(true);
  });
});

describe('checkDmarc', () => {
  it('returns missing when no record', async () => {
    mocks.resolveTxt.mockRejectedValue(new Error('ENODATA'));
    const r = await checkDmarc('example.com');
    expect(r.valid).toBe(false);
    expect(r.policy).toBe(null);
  });

  it('parses p=quarantine with rua', async () => {
    mocks.resolveTxt.mockResolvedValue([['v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com']]);
    const r = await checkDmarc('example.com');
    expect(r.valid).toBe(true);
    expect(r.policy).toBe('quarantine');
    expect(r.hasRua).toBe(true);
  });

  it('flags p=none and missing rua', async () => {
    mocks.resolveTxt.mockResolvedValue([['v=DMARC1; p=none']]);
    const r = await checkDmarc('example.com');
    expect(r.issues.some((i) => i.includes('p=none'))).toBe(true);
    expect(r.issues.some((i) => i.includes('rua'))).toBe(true);
  });

  it('flags pct < 100', async () => {
    mocks.resolveTxt.mockResolvedValue([['v=DMARC1; p=quarantine; pct=25; rua=mailto:x@y.com']]);
    const r = await checkDmarc('example.com');
    expect(r.issues.some((i) => i.includes('pct=25'))).toBe(true);
  });
});

describe('checkMx', () => {
  it('returns sorted exchange hostnames', async () => {
    mocks.resolveMx.mockResolvedValue([
      { exchange: 'mx2.example.com', priority: 20 },
      { exchange: 'mx1.example.com', priority: 10 },
    ]);
    const r = await checkMx('example.com');
    expect(r).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  it('returns [] on error', async () => {
    mocks.resolveMx.mockRejectedValue(new Error('oops'));
    expect(await checkMx('example.com')).toEqual([]);
  });
});

describe('calculateHealthScore', () => {
  const baseGood = {
    spf: { valid: true, record: 'v=spf1 mx -all', lookupCount: 1, issues: [] },
    dkim: [{ selector: 'mail', valid: true, record: 'p=x', issues: [] }],
    dmarc: { valid: true, record: 'v=DMARC1; p=reject; rua=mailto:x@y.com', policy: 'reject' as const, hasRua: true, issues: [] },
    mx: ['mx.example.com'],
  };
  it('100 for fully valid domain', () => {
    expect(calculateHealthScore(baseGood)).toBe(100);
  });
  it('drops on missing SPF/DKIM/DMARC/MX', () => {
    expect(calculateHealthScore({ ...baseGood, spf: { ...baseGood.spf, valid: false } })).toBeLessThan(100);
    expect(calculateHealthScore({ ...baseGood, dkim: [{ ...baseGood.dkim[0], valid: false }] })).toBeLessThan(100);
    expect(calculateHealthScore({ ...baseGood, mx: [] })).toBeLessThan(100);
  });
  it('clamps at 0', () => {
    expect(calculateHealthScore({
      spf: { valid: false, record: null, lookupCount: 0, issues: ['x'] },
      dkim: [{ selector: 'mail', valid: false, record: null, issues: ['x'] }],
      dmarc: { valid: false, record: null, policy: null, hasRua: false, issues: ['x'] },
      mx: [],
    })).toBeGreaterThanOrEqual(0);
  });
});

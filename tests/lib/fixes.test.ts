import { describe, it, expect } from 'vitest';
import { resolveFix, resolveBlacklistFix } from '../../apps/web/src/lib/fixes';

describe('resolveFix', () => {
  it('maps "No SPF record found" to a suggestion containing v=spf1', () => {
    const fix = resolveFix('No SPF record found', 'example.com');
    expect(fix).not.toBeNull();
    expect(fix!.suggested?.[0].value).toContain('v=spf1');
    expect(fix!.suggested?.[0].host).toBe('example.com');
  });

  it('maps DMARC p=none to a quarantine-upgrade suggestion', () => {
    const fix = resolveFix('DMARC policy is p=none — emails not protected yet', 'example.com');
    expect(fix!.suggested?.[0].value).toContain('p=quarantine');
    expect(fix!.suggested?.[0].host).toBe('_dmarc.example.com');
  });

  it('maps DKIM selector-not-found using the quoted selector', () => {
    const fix = resolveFix("DKIM selector 'dkim2026' not found", 'example.com');
    expect(fix!.suggested?.[0].host).toBe('dkim2026._domainkey.example.com');
  });

  it('returns null for unknown issues', () => {
    expect(resolveFix('something unmatched', 'example.com')).toBeNull();
  });
});

describe('resolveBlacklistFix', () => {
  it('has PBL-specific copy and removal URL', () => {
    const fix = resolveBlacklistFix('Spamhaus PBL', '1.2.3.4');
    expect(fix.title).toContain('PBL');
    expect(fix.removalUrl).toContain('spamhaus.org');
    expect(fix.steps.some((s) => /relay/i.test(s))).toBe(true);
  });

  it('falls back for unknown blacklists', () => {
    const fix = resolveBlacklistFix('Random RBL', '1.2.3.4');
    expect(fix.title).toContain('Random RBL');
    expect(fix.steps.length).toBeGreaterThan(0);
  });
});

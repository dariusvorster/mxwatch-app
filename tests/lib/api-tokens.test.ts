import { describe, it, expect } from 'vitest';
import { generateApiToken, hashToken, isWellFormedToken } from '../../apps/web/src/lib/api-tokens';

describe('api-tokens', () => {
  it('generates tokens with mxw_ prefix and consistent hash', () => {
    const t = generateApiToken();
    expect(t.plaintext.startsWith('mxw_')).toBe(true);
    expect(t.displayPrefix).toBe(t.plaintext.slice(0, 8));
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });

  it('produces unique tokens', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it('validates well-formed tokens', () => {
    const t = generateApiToken();
    expect(isWellFormedToken(t.plaintext)).toBe(true);
    expect(isWellFormedToken('bearer xyz')).toBe(false);
    expect(isWellFormedToken('mxw_short')).toBe(false);
    expect(isWellFormedToken('')).toBe(false);
  });
});

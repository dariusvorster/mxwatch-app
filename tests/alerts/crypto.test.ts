import { describe, it, expect, beforeEach } from 'vitest';
import { encryptJSON, decryptJSON } from '../../packages/alerts/src/crypto';

beforeEach(() => {
  process.env.MXWATCH_SECRET = 'a'.repeat(32);
});

describe('crypto', () => {
  it('round-trips a JSON object', () => {
    const payload = { to: 'alerts@example.com', nested: [1, 2, 3] };
    const blob = encryptJSON(payload);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decryptJSON(blob)).toEqual(payload);
  });

  it('produces a different ciphertext each time', () => {
    const a = encryptJSON({ x: 1 });
    const b = encryptJSON({ x: 1 });
    expect(a).not.toBe(b);
  });

  it('fails auth on tampered ciphertext', () => {
    const blob = encryptJSON({ to: 'x@y.com' });
    const [prefix, iv, tag, ct] = blob.split(':');
    // Flip one byte in ciphertext
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === '00' ? 'ff' : '00');
    const tampered = [prefix, iv, tag, flipped].join(':');
    expect(() => decryptJSON(tampered)).toThrow();
  });

  it('accepts plain JSON as legacy fallback', () => {
    expect(decryptJSON('{"to":"legacy@example.com"}')).toEqual({ to: 'legacy@example.com' });
  });

  it('throws when MXWATCH_SECRET is too short', () => {
    process.env.MXWATCH_SECRET = 'short';
    expect(() => encryptJSON({ x: 1 })).toThrow(/MXWATCH_SECRET/);
  });
});

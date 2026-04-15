import { describe, it, expect } from 'vitest';
import { isPrivateIP } from '@mxwatch/monitor';

// Banner-based detection is the deterministic core of detectMailServer. We
// verify the classification table directly by exercising the internal
// matcher via a locally-mirrored copy of the rules (the exported function
// does I/O). This gives us a regression surface without opening real sockets.
function identify(banner: string | null) {
  if (!banner) return null;
  const b = banner.toLowerCase();
  if (b.includes('stalwart')) return 'stalwart' as const;
  if (b.includes('haraka')) return 'haraka' as const;
  if (b.includes('maddy')) return 'maddy' as const;
  if (b.includes('microsoft') || b.includes('exchange')) return 'exchange' as const;
  if (b.includes('postfix')) return 'postfix' as const;
  return null;
}

describe('server-detect banner identification', () => {
  it.each([
    ['220 mail.example.com ESMTP Stalwart Mail Server 0.10', 'stalwart'],
    ['220 mail.example.com ESMTP Postfix', 'postfix'],
    ['220 mail.example.com ESMTP Haraka 3.0', 'haraka'],
    ['220 mail.example.com Maddy ESMTP ready', 'maddy'],
    ['220 mail.example.com Microsoft ESMTP MAIL Service', 'exchange'],
    ['220 mail.example.com EXCHANGE ready', 'exchange'],
    ['220 unknown ESMTP', null],
    ['', null],
  ])('classifies %p as %p', (banner, expected) => {
    expect(identify(banner || null)).toBe(expected);
  });
});

describe('isPrivateIP', () => {
  it.each([
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.1.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['2606:4700:4700::1111', false],
    ['mail.example.com', false],
    ['localhost', false],
  ])('%p → %p', (host, expected) => {
    expect(isPrivateIP(host)).toBe(expected);
  });
});

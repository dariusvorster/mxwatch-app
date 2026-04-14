import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'mxw_';

export interface GeneratedToken {
  plaintext: string;   // show to user once
  hash: string;        // store in DB
  displayPrefix: string; // first 8 chars of plaintext, safe to store/show
}

export function generateApiToken(): GeneratedToken {
  const raw = randomBytes(24).toString('base64url'); // 32 chars URL-safe
  const plaintext = `${PREFIX}${raw}`;
  return {
    plaintext,
    hash: hashToken(plaintext),
    displayPrefix: plaintext.slice(0, 8),
  };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function isWellFormedToken(s: string): boolean {
  return s.startsWith(PREFIX) && s.length >= PREFIX.length + 16;
}

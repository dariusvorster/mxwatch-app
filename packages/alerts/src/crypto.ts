import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
// Fixed scrypt salt — key derivation is deterministic from MXWATCH_SECRET so
// stored ciphertexts remain decryptable across process restarts. Rotating
// MXWATCH_SECRET invalidates all stored channel configs.
const SCRYPT_SALT = Buffer.from('mxwatch-channel-salt-v1');

function deriveKey(): Buffer {
  const secret = process.env.MXWATCH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('MXWATCH_SECRET must be set (>= 16 chars) to encrypt channel configs');
  }
  return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
}

export function encryptJSON(value: unknown): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Stored format: v1:<iv-hex>:<tag-hex>:<ciphertext-hex>
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptJSON<T = unknown>(blob: string): T {
  // Backwards-compat: if blob doesn't start with v1: treat as plain JSON
  // (old channels written before encryption was wired up).
  if (!blob.startsWith('v1:')) {
    return JSON.parse(blob) as T;
  }
  const [, ivHex, tagHex, cipherHex] = blob.split(':');
  if (!ivHex || !tagHex || !cipherHex) throw new Error('Malformed encrypted blob');
  const key = deriveKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  if (tag.length !== TAG_LEN) throw new Error('Invalid auth tag length');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

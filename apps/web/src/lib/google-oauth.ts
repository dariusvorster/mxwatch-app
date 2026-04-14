import { createHmac, randomBytes } from 'node:crypto';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { encryptJSON, decryptJSON } from '@mxwatch/alerts';
import { eq } from 'drizzle-orm';
import { GOOGLE_SCOPE, googleClientId, googleClientSecret, googleRedirectUrl } from './google-config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// --- Signed state (HMAC so we don't need a storage table) ---

function hmacSecret(): string {
  const s = process.env.MXWATCH_SECRET;
  if (!s) throw new Error('MXWATCH_SECRET not set');
  return s;
}

export function signState(userId: string): string {
  const nonce = randomBytes(8).toString('hex');
  const ts = Date.now();
  const payload = `${userId}:${nonce}:${ts}`;
  const sig = createHmac('sha256', hmacSecret()).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyState(state: string, maxAgeMs = 10 * 60 * 1000): { userId: string } | null {
  try {
    const [userId, nonce, tsStr, sig] = Buffer.from(state, 'base64url').toString().split(':');
    if (!userId || !nonce || !tsStr || !sig) return null;
    const expected = createHmac('sha256', hmacSecret()).update(`${userId}:${nonce}:${tsStr}`).digest('hex').slice(0, 16);
    if (expected !== sig) return null;
    if (Date.now() - Number(tsStr) > maxAgeMs) return null;
    return { userId };
  } catch { return null; }
}

// --- OAuth URLs ---

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleRedirectUrl(),
    response_type: 'code',
    scope: [GOOGLE_SCOPE, 'openid', 'email'].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// --- Token exchange ---

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUrl(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json() as { email?: string };
    return data.email ?? null;
  } catch { return null; }
}

// --- Connection storage ---

export async function saveConnection(userId: string, tokens: TokenResponse): Promise<void> {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
  const googleEmail = await fetchGoogleEmail(tokens.access_token);

  const [existing] = await db
    .select()
    .from(schema.userGoogleOAuth)
    .where(eq(schema.userGoogleOAuth.userId, userId))
    .limit(1);

  const base = {
    googleEmail,
    accessTokenEnc: encryptJSON(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token ? encryptJSON(tokens.refresh_token) : (existing?.refreshTokenEnc ?? null),
    expiresAt,
    scope: tokens.scope ?? null,
    updatedAt: now,
  };

  if (existing) {
    await db.update(schema.userGoogleOAuth).set(base).where(eq(schema.userGoogleOAuth.id, existing.id));
  } else {
    await db.insert(schema.userGoogleOAuth).values({
      id: nanoid(),
      userId,
      ...base,
      createdAt: now,
    });
  }
}

export async function disconnect(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.userGoogleOAuth).where(eq(schema.userGoogleOAuth.userId, userId));
}

/** Returns a valid access token for the user, refreshing if expired. */
export async function getAccessToken(userId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.userGoogleOAuth)
    .where(eq(schema.userGoogleOAuth.userId, userId))
    .limit(1);
  if (!row) return null;

  const skewMs = 60_000;
  if (row.expiresAt.getTime() > Date.now() + skewMs) {
    return decryptJSON<string>(row.accessTokenEnc);
  }

  if (!row.refreshTokenEnc) return null;
  const refresh = decryptJSON<string>(row.refreshTokenEnc);
  const tokens = await refreshAccessToken(refresh);
  await saveConnection(userId, tokens);
  return tokens.access_token;
}

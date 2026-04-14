import { getDb, schema } from '@mxwatch/db';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, isWellFormedToken } from './api-tokens';
import { auth } from './auth';

export interface ApiAuthResult {
  userId: string;
  tokenId: string;
}

/** Accepts either `Authorization: Bearer mxw_…` or a logged-in session cookie. */
export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult | null> {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) {
    const token = match[1].trim();
    if (!isWellFormedToken(token)) return null;
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.userApiTokens)
      .where(and(
        eq(schema.userApiTokens.tokenHash, hashToken(token)),
        isNull(schema.userApiTokens.revokedAt),
      ))
      .limit(1);
    if (!row) return null;
    db.update(schema.userApiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.userApiTokens.id, row.id))
      .catch(() => {});
    return { userId: row.userId, tokenId: row.id };
  }

  // Fall back to the better-auth session cookie so signed-in users can hit
  // the same endpoints for in-app downloads without creating a token.
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user?.id) return { userId: session.user.id, tokenId: 'session' };
  } catch {}
  return null;
}

export function unauthorized(msg = 'Missing or invalid token') {
  return Response.json({ error: msg }, { status: 401 });
}

import { nanoid } from 'nanoid';
import { getDb } from './client';
import * as schema from './schema';

/**
 * Append a row to activity_log. Caller passes ipAddress + userAgent so this
 * module stays Next-free (callable from any tRPC procedure or background
 * worker that already has the request context). `detail` is JSON-stringified
 * for storage.
 */
export async function logActivity(params: {
  userId: string;
  action: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.activityLog).values({
    id: nanoid(),
    userId: params.userId,
    action: params.action,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    detail: params.detail ? JSON.stringify(params.detail) : null,
    createdAt: new Date(),
  });
}

import { z } from 'zod';
import crypto from 'node:crypto';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid, logActivity, logger } from '@mxwatch/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

// Base58 alphabet (Bitcoin) — no 0/O/I/l confusion. Used for new API tokens.
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function generateRandomBase58(byteCount: number): string {
  const buf = crypto.randomBytes(byteCount);
  let out = '';
  for (const b of buf) out += BASE58[b % BASE58.length];
  return out;
}

const SCOPES = ['domains:read', 'checks:read', 'reports:read', 'alerts:read', 'alerts:write'] as const;

const CIDR_OR_IP = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\/(?:[0-9]|[12]\d|3[0-2]))?$|^[0-9a-fA-F:]+(?:\/(?:\d|[1-9]\d|1[01]\d|12[0-8]))?$/;

export const securityRouter = router({
  // ─── Sessions ──────────────────────────────────────────────────
  sessionsList: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, ctx.user.id))
      .orderBy(desc(schema.sessions.createdAt));
    return rows.map((r) => ({
      id: r.id,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      isCurrent: r.id === ctx.session?.id,
    }));
  }),

  sessionRevoke: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId === ctx.session?.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use logout to end the current session.' });
      }
      await ctx.db
        .delete(schema.sessions)
        .where(and(eq(schema.sessions.id, input.sessionId), eq(schema.sessions.userId, ctx.user.id)));
      await logActivity({
        userId: ctx.user.id, action: 'session_revoked',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        detail: { sessionId: input.sessionId },
      });
      return { ok: true };
    }),

  sessionRevokeAll: protectedProcedure.mutation(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, ctx.user.id));
    const otherIds = rows.map((r) => r.id).filter((id) => id !== ctx.session?.id);
    for (const id of otherIds) {
      await ctx.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    }
    await logActivity({
      userId: ctx.user.id, action: 'all_sessions_revoked',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      detail: { count: otherIds.length },
    });
    return { revoked: otherIds.length };
  }),

  // ─── API tokens ────────────────────────────────────────────────
  apiTokensList: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.name,
        prefix: schema.apiTokens.prefix,
        scopes: schema.apiTokens.scopes,
        lastUsedAt: schema.apiTokens.lastUsedAt,
        lastUsedIp: schema.apiTokens.lastUsedIp,
        expiresAt: schema.apiTokens.expiresAt,
        revokedAt: schema.apiTokens.revokedAt,
        createdAt: schema.apiTokens.createdAt,
      })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.userId, ctx.user.id))
      .orderBy(desc(schema.apiTokens.createdAt));
    return rows.map((r) => ({ ...r, scopes: JSON.parse(r.scopes) as string[] }));
  }),

  apiTokenCreate: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(z.enum(SCOPES)).min(1),
      expiresInDays: z.number().int().min(1).max(3650).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tokenPrefix = process.env.MXWATCH_CLOUD === '1' ? 'mxw_live_' : 'mxw_self_';
      const token = tokenPrefix + generateRandomBase58(32);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const id = nanoid();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86400 * 1000)
        : null;
      await ctx.db.insert(schema.apiTokens).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        tokenHash,
        prefix: token.slice(0, 16),
        scopes: JSON.stringify(input.scopes),
        expiresAt,
        createdAt: new Date(),
      });
      await logActivity({
        userId: ctx.user.id, action: 'api_token_created',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        detail: { name: input.name, scopes: input.scopes, expiresInDays: input.expiresInDays },
      });
      // Plaintext returned exactly once — caller must capture it now.
      return { id, token, prefix: token.slice(0, 16) };
    }),

  apiTokenRevoke: protectedProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.apiTokens)
        .where(and(eq(schema.apiTokens.id, input.tokenId), eq(schema.apiTokens.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.apiTokens.id, input.tokenId));
      await logActivity({
        userId: ctx.user.id, action: 'api_token_revoked',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        detail: { name: row.name },
      });
      return { ok: true };
    }),

  // ─── IP allowlist ──────────────────────────────────────────────
  ipAllowlistGet: protectedProcedure.query(async ({ ctx }) => {
    const [u] = await ctx.db
      .select({ ipAllowlist: schema.users.ipAllowlist })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.user.id))
      .limit(1);
    return {
      entries: (u?.ipAllowlist ? (JSON.parse(u.ipAllowlist) as string[]) : []),
      currentIp: ctx.ipAddress,
    };
  }),

  ipAllowlistSet: protectedProcedure
    .input(z.object({ entries: z.array(z.string().regex(CIDR_OR_IP, 'Invalid IP or CIDR')).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.users)
        .set({ ipAllowlist: input.entries.length > 0 ? JSON.stringify(input.entries) : null, updatedAt: new Date() })
        .where(eq(schema.users.id, ctx.user.id));
      await logActivity({
        userId: ctx.user.id, action: 'ip_allowlist_changed',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        detail: { count: input.entries.length },
      });
      void logger.info('auth', 'IP allowlist updated', { userId: ctx.user.id, entryCount: input.entries.length });
      return { ok: true };
    }),

  // ─── Password change ───────────────────────────────────────────
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12, 'Password must be at least 12 characters'),
      confirmPassword: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.newPassword !== input.confirmPassword) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Passwords do not match' });
      }
      // Defer to better-auth's account password update — it handles bcrypt
      // round-tripping. Imported here to avoid loading auth at module init.
      const { auth } = await import('@/lib/auth');
      try {
        await (auth.api as any).changePassword({
          body: {
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            revokeOtherSessions: true,
          },
          headers: new Headers({ cookie: '' }), // session is on ctx, but better-auth uses its own
          asResponse: false,
        });
      } catch (e: any) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: e?.message ?? 'Password change failed' });
      }
      await logActivity({
        userId: ctx.user.id, action: 'password_changed',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      });
      void logger.info('auth', 'Password changed', { userId: ctx.user.id });
      return { ok: true };
    }),

  // ─── Activity log ──────────────────────────────────────────────
  activityLog: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(schema.activityLog)
        .where(eq(schema.activityLog.userId, ctx.user.id))
        .orderBy(desc(schema.activityLog.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({
        ...r,
        detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
      }));
    }),
});

// Used by middleware to enforce the IP allowlist outside of tRPC.
export { CIDR_OR_IP };

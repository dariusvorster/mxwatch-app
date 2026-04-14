import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { disconnect } from '@/lib/google-oauth';
import { googleEnabled } from '@/lib/google-config';
import { syncPostmasterForUser } from '@/lib/sync-postmaster';

export const googleRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const enabled = googleEnabled();
    const [row] = await ctx.db
      .select({
        googleEmail: schema.userGoogleOAuth.googleEmail,
        scope: schema.userGoogleOAuth.scope,
        expiresAt: schema.userGoogleOAuth.expiresAt,
        lastSyncAt: schema.userGoogleOAuth.lastSyncAt,
        lastSyncError: schema.userGoogleOAuth.lastSyncError,
      })
      .from(schema.userGoogleOAuth)
      .where(eq(schema.userGoogleOAuth.userId, ctx.user.id))
      .limit(1);
    return {
      enabled,
      connected: !!row,
      googleEmail: row?.googleEmail ?? null,
      scope: row?.scope ?? null,
      expiresAt: row?.expiresAt ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastSyncError: row?.lastSyncError ?? null,
    };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await disconnect(ctx.user.id);
    return { ok: true };
  }),

  syncNow: protectedProcedure.mutation(async ({ ctx }) => {
    if (!googleEnabled()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google integration not configured' });
    return syncPostmasterForUser(ctx.user.id);
  }),

  domainStats: protectedProcedure
    .input(z.object({ domainId: z.string(), days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const [owned] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const sinceIso = since.toISOString().slice(0, 10);
      const rows = await ctx.db
        .select()
        .from(schema.postmasterStats)
        .where(and(
          eq(schema.postmasterStats.domainId, input.domainId),
          gte(schema.postmasterStats.date, sinceIso),
        ))
        .orderBy(desc(schema.postmasterStats.date));

      return rows.map((r) => ({
        date: r.date,
        spamRate: r.spamRate != null ? Number(r.spamRate) : null,
        ipReputations: r.ipReputations ? JSON.parse(r.ipReputations) as { bad: number; low: number; medium: number; high: number } : null,
        domainReputation: r.domainReputation,
        dkimSuccessRatio: r.dkimSuccessRatio != null ? Number(r.dkimSuccessRatio) : null,
        spfSuccessRatio: r.spfSuccessRatio != null ? Number(r.spfSuccessRatio) : null,
        dmarcSuccessRatio: r.dmarcSuccessRatio != null ? Number(r.dmarcSuccessRatio) : null,
        deliveryErrors: r.deliveryErrors ? JSON.parse(r.deliveryErrors) as Array<{ errorType: string; errorClass: string; errorRatio?: number }> : null,
      }));
    }),
});

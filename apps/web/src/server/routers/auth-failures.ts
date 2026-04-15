import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

async function assertOwnedIntegration(ctx: any, integrationId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.serverIntegrations)
    .where(and(
      eq(schema.serverIntegrations.id, integrationId),
      eq(schema.serverIntegrations.userId, ctx.user.id),
    ))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const authFailuresRouter = router({
  list: protectedProcedure
    .input(z.object({
      integrationId: z.string(),
      since: z.date().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnedIntegration(ctx, input.integrationId);
      const conditions = [eq(schema.authFailureEvents.integrationId, input.integrationId)];
      if (input.since) conditions.push(gte(schema.authFailureEvents.detectedAt, input.since));
      return ctx.db
        .select()
        .from(schema.authFailureEvents)
        .where(and(...conditions))
        .orderBy(desc(schema.authFailureEvents.detectedAt))
        .limit(input.limit);
    }),

  /** Aggregate failed attempts per source IP over the last N hours. */
  byIp: protectedProcedure
    .input(z.object({
      integrationId: z.string(),
      hours: z.number().int().min(1).max(168).default(24),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnedIntegration(ctx, input.integrationId);
      const since = new Date(Date.now() - input.hours * 3600 * 1000);
      const rows = await ctx.db
        .select({
          ip: schema.authFailureEvents.ip,
          attempts: sql<number>`sum(${schema.authFailureEvents.count})`,
          lastSeen: sql<Date>`max(${schema.authFailureEvents.detectedAt})`,
        })
        .from(schema.authFailureEvents)
        .where(and(
          eq(schema.authFailureEvents.integrationId, input.integrationId),
          gte(schema.authFailureEvents.detectedAt, since),
        ))
        .groupBy(schema.authFailureEvents.ip)
        .orderBy(sql`sum(${schema.authFailureEvents.count}) desc`)
        .limit(50);
      return rows.map((r) => ({
        ip: r.ip,
        attempts: Number(r.attempts),
        lastSeen: r.lastSeen instanceof Date ? r.lastSeen : new Date(Number(r.lastSeen) * 1000),
      }));
    }),
});

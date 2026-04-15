import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

async function assertOwnedDomain(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const recipientDomainsRouter = router({
  /** Latest rollup per recipient domain for a given period. */
  stats: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      period: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
      minSent: z.number().int().min(0).max(10000).default(5),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnedDomain(ctx, input.domainId);
      const rows = await ctx.db
        .select()
        .from(schema.recipientDomainStats)
        .where(and(
          eq(schema.recipientDomainStats.domainId, input.domainId),
          eq(schema.recipientDomainStats.period, input.period),
        ))
        .orderBy(desc(schema.recipientDomainStats.recordedAt));
      // Collapse to one row per recipient (latest wins).
      const latest = new Map<string, typeof rows[number]>();
      for (const r of rows) {
        if (!latest.has(r.recipientDomain)) latest.set(r.recipientDomain, r);
      }
      return Array.from(latest.values())
        .filter((r) => (r.sent ?? 0) >= input.minSent)
        .sort((a, b) => (b.sent ?? 0) - (a.sent ?? 0));
    }),

  /** Daily delivery-rate trend for one recipient domain. */
  trend: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      recipientDomain: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnedDomain(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 86400 * 1000);
      const rows = await ctx.db
        .select()
        .from(schema.recipientDomainStats)
        .where(and(
          eq(schema.recipientDomainStats.domainId, input.domainId),
          eq(schema.recipientDomainStats.recipientDomain, input.recipientDomain),
          eq(schema.recipientDomainStats.period, '24h'),
          gte(schema.recipientDomainStats.recordedAt, since),
        ))
        .orderBy(schema.recipientDomainStats.recordedAt);
      return rows;
    }),

  /** Recipient domains with delivery rate < 95% in the last 24h. */
  problems: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedDomain(ctx, input.domainId);
      const rows = await ctx.db
        .select()
        .from(schema.recipientDomainStats)
        .where(and(
          eq(schema.recipientDomainStats.domainId, input.domainId),
          eq(schema.recipientDomainStats.period, '24h'),
          lt(schema.recipientDomainStats.deliveryRate, 950), // stored as ×10 for one-decimal precision
        ))
        .orderBy(desc(schema.recipientDomainStats.recordedAt));
      const latest = new Map<string, typeof rows[number]>();
      for (const r of rows) {
        if (!latest.has(r.recipientDomain)) latest.set(r.recipientDomain, r);
      }
      return Array.from(latest.values());
    }),
});

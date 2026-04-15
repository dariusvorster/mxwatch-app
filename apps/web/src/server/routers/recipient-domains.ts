import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte, lt, inArray } from 'drizzle-orm';
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

  /** Cross-domain rollup — aggregates the latest 24h rate per recipient
   * provider across every domain the user owns. Used by /delivery-rates. */
  crossStats: protectedProcedure
    .input(z.object({
      period: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
      minSent: z.number().int().min(0).max(10000).default(5),
    }))
    .query(async ({ ctx, input }) => {
      const ownedDomains = await ctx.db
        .select({ id: schema.domains.id, name: schema.domains.domain })
        .from(schema.domains)
        .where(eq(schema.domains.userId, ctx.user.id));
      if (ownedDomains.length === 0) return [];
      const rows = await ctx.db
        .select()
        .from(schema.recipientDomainStats)
        .where(and(
          inArray(schema.recipientDomainStats.domainId, ownedDomains.map((d) => d.id)),
          eq(schema.recipientDomainStats.period, input.period),
        ))
        .orderBy(desc(schema.recipientDomainStats.recordedAt));

      // Keep only the latest row per (sourceDomain, recipientDomain) pair, then
      // collapse across all source domains so we report one entry per
      // recipient provider with summed counts.
      const latestPerPair = new Map<string, typeof rows[number]>();
      for (const r of rows) {
        const k = `${r.domainId}|${r.recipientDomain}`;
        if (!latestPerPair.has(k)) latestPerPair.set(k, r);
      }
      const agg = new Map<string, { sent: number; delivered: number; bounced: number; deferred: number; lastBounceReason?: string }>();
      for (const r of latestPerPair.values()) {
        const existing = agg.get(r.recipientDomain) ?? { sent: 0, delivered: 0, bounced: 0, deferred: 0 };
        existing.sent += r.sent ?? 0;
        existing.delivered += r.delivered ?? 0;
        existing.bounced += r.bounced ?? 0;
        existing.deferred += r.deferred ?? 0;
        if (r.lastBounceReason) existing.lastBounceReason = r.lastBounceReason;
        agg.set(r.recipientDomain, existing);
      }
      return Array.from(agg.entries())
        .map(([recipientDomain, v]) => ({
          recipientDomain,
          sent: v.sent,
          delivered: v.delivered,
          bounced: v.bounced,
          deferred: v.deferred,
          // ×10 stored format → number for the UI to format
          deliveryRate: v.sent > 0 ? Math.round((v.delivered / v.sent) * 1000) : null,
          lastBounceReason: v.lastBounceReason,
        }))
        .filter((r) => r.sent >= input.minSent)
        .sort((a, b) => b.sent - a.sent);
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

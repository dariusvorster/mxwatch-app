import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export const bouncesRouter = router({
  list: protectedProcedure
    .input(z.object({
      domainId: z.string().optional(),
      since: z.date().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      onlyUnacknowledged: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(schema.domains.userId, ctx.user.id)];
      if (input.domainId) conditions.push(eq(schema.bounceEvents.domainId, input.domainId));
      if (input.since) conditions.push(gte(schema.bounceEvents.timestamp, input.since));
      if (input.onlyUnacknowledged) conditions.push(eq(schema.bounceEvents.acknowledged, false));

      const rows = await ctx.db
        .select({
          id: schema.bounceEvents.id,
          domainId: schema.bounceEvents.domainId,
          domainName: schema.domains.domain,
          timestamp: schema.bounceEvents.timestamp,
          originalTo: schema.bounceEvents.originalTo,
          recipientDomain: schema.bounceEvents.recipientDomain,
          bounceType: schema.bounceEvents.bounceType,
          errorCode: schema.bounceEvents.errorCode,
          errorMessage: schema.bounceEvents.errorMessage,
          remoteMTA: schema.bounceEvents.remoteMTA,
          relatedRBL: schema.bounceEvents.relatedRBL,
          severity: schema.bounceEvents.severity,
          acknowledged: schema.bounceEvents.acknowledged,
        })
        .from(schema.bounceEvents)
        .innerJoin(schema.domains, eq(schema.bounceEvents.domainId, schema.domains.id))
        .where(and(...conditions))
        .orderBy(desc(schema.bounceEvents.timestamp))
        .limit(input.limit);
      return rows;
    }),

  detail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ b: schema.bounceEvents, userId: schema.domains.userId })
        .from(schema.bounceEvents)
        .innerJoin(schema.domains, eq(schema.bounceEvents.domainId, schema.domains.id))
        .where(eq(schema.bounceEvents.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return row.b;
    }),

  acknowledge: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ userId: schema.domains.userId })
        .from(schema.bounceEvents)
        .innerJoin(schema.domains, eq(schema.bounceEvents.domainId, schema.domains.id))
        .where(eq(schema.bounceEvents.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.bounceEvents)
        .set({ acknowledged: true })
        .where(eq(schema.bounceEvents.id, input.id));
      return { ok: true };
    }),
});

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte } from 'drizzle-orm';
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

export const queueRouter = router({
  /** Most recent queue snapshot for an integration. */
  current: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedIntegration(ctx, input.integrationId);
      const [row] = await ctx.db
        .select()
        .from(schema.queueSnapshots)
        .where(eq(schema.queueSnapshots.integrationId, input.integrationId))
        .orderBy(desc(schema.queueSnapshots.recordedAt))
        .limit(1);
      return row ?? null;
    }),

  /** Time-series of queue depth over the last N hours. */
  history: protectedProcedure
    .input(z.object({
      integrationId: z.string(),
      hours: z.number().int().min(1).max(168).default(24),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnedIntegration(ctx, input.integrationId);
      const since = new Date(Date.now() - input.hours * 3600 * 1000);
      return ctx.db
        .select()
        .from(schema.queueSnapshots)
        .where(and(
          eq(schema.queueSnapshots.integrationId, input.integrationId),
          gte(schema.queueSnapshots.recordedAt, since),
        ))
        .orderBy(schema.queueSnapshots.recordedAt);
    }),
});

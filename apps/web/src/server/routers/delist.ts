import { z } from 'zod';
import { router, protectedProcedure, publicProcedure } from '../trpc';
import { schema, nanoid, logger } from '@mxwatch/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { RBL_KNOWLEDGE, appendTimelineEvent } from '@mxwatch/monitor';

async function assertDomain(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Domain not found' });
  return row;
}

async function assertRequest(ctx: any, requestId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.delistRequests)
    .where(and(eq(schema.delistRequests.id, requestId), eq(schema.delistRequests.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Delist request not found' });
  return row;
}

export const delistRouter = router({
  list: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertDomain(ctx, input.domainId);
      return ctx.db
        .select()
        .from(schema.delistRequests)
        .where(eq(schema.delistRequests.domainId, input.domainId))
        .orderBy(desc(schema.delistRequests.createdAt));
    }),

  /** Idempotent — returns the existing active row for (domain, rbl, value)
   *  when one exists, else creates a new not_submitted row. */
  getOrCreate: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      rblName: z.string().trim().min(1).max(80),
      listedValue: z.string().trim().min(1).max(253),
      listingType: z.enum(['ip', 'domain']),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDomain(ctx, input.domainId);
      const [existing] = await ctx.db
        .select()
        .from(schema.delistRequests)
        .where(and(
          eq(schema.delistRequests.domainId, input.domainId),
          eq(schema.delistRequests.rblName, input.rblName),
          eq(schema.delistRequests.listedValue, input.listedValue),
          inArray(schema.delistRequests.status, ['not_submitted', 'submitted', 'pending']),
        ))
        .limit(1);
      if (existing) return existing;

      const now = new Date();
      const id = nanoid();
      await ctx.db.insert(schema.delistRequests).values({
        id,
        userId: ctx.user.id,
        domainId: input.domainId,
        rblName: input.rblName,
        listedValue: input.listedValue,
        listingType: input.listingType,
        status: 'not_submitted',
        timeline: appendTimelineEvent('[]', { event: 'started', detail: 'Delist wizard opened' }),
        createdAt: now,
        updatedAt: now,
      });
      const [row] = await ctx.db
        .select()
        .from(schema.delistRequests)
        .where(eq(schema.delistRequests.id, id))
        .limit(1);
      return row!;
    }),

  markSubmitted: protectedProcedure
    .input(z.object({
      requestId: z.string(),
      method: z.enum(['form', 'email', 'manual_confirmed']),
      note: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const request = await assertRequest(ctx, input.requestId);
      await ctx.db
        .update(schema.delistRequests)
        .set({
          status: 'pending',
          submittedAt: new Date(),
          submissionMethod: input.method,
          submissionNote: input.note ?? null,
          pollingEnabled: true,
          lastPolledAt: new Date(),
          timeline: appendTimelineEvent(request.timeline, {
            event: 'submitted', detail: `Submitted via ${input.method}`,
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.delistRequests.id, request.id));
      void logger.info('rbl', 'Delist request submitted', {
        requestId: request.id, rblName: request.rblName, method: input.method,
      });
      return { ok: true };
    }),

  /** Triggers an immediate poll for one user-owned request. */
  checkNow: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await assertRequest(ctx, input.requestId);
      const { pollDelistRequest } = await import('@/lib/run-delist-poll');
      await pollDelistRequest(row.id);
      const [updated] = await ctx.db
        .select()
        .from(schema.delistRequests)
        .where(eq(schema.delistRequests.id, row.id))
        .limit(1);
      return updated!;
    }),

  getRBLInfo: publicProcedure
    .input(z.object({ rblName: z.string() }))
    .query(({ input }) => RBL_KNOWLEDGE[input.rblName] ?? null),

  knownRBLs: publicProcedure.query(() => RBL_KNOWLEDGE),
});

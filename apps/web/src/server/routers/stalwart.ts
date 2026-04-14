import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { encryptJSON, decryptJSON } from '@mxwatch/alerts';
import { StalwartClient } from '@mxwatch/monitor';
import { and, desc, eq, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomBytes } from 'node:crypto';
import { pullStalwartForIntegration } from '@/lib/run-stalwart-pull';

async function assertOwned(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.stalwartIntegrations)
    .where(and(eq(schema.stalwartIntegrations.id, id), eq(schema.stalwartIntegrations.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const stalwartRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: schema.stalwartIntegrations.id,
        name: schema.stalwartIntegrations.name,
        baseUrl: schema.stalwartIntegrations.baseUrl,
        pullEnabled: schema.stalwartIntegrations.pullEnabled,
        pushEnabled: schema.stalwartIntegrations.pushEnabled,
        lastPulledAt: schema.stalwartIntegrations.lastPulledAt,
        lastError: schema.stalwartIntegrations.lastError,
        status: schema.stalwartIntegrations.status,
        createdAt: schema.stalwartIntegrations.createdAt,
      })
      .from(schema.stalwartIntegrations)
      .where(eq(schema.stalwartIntegrations.userId, ctx.user.id))
      .orderBy(desc(schema.stalwartIntegrations.createdAt));
    return rows;
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(100),
      baseUrl: z.string().url(),
      token: z.string().min(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      const webhookSecret = randomBytes(32).toString('hex');
      await ctx.db.insert(schema.stalwartIntegrations).values({
        id,
        userId: ctx.user.id,
        name: input.name,
        baseUrl: input.baseUrl.replace(/\/$/, ''),
        encryptedToken: encryptJSON(input.token),
        webhookSecret,
        pullEnabled: true,
        pushEnabled: false,
        status: 'unknown',
        createdAt: new Date(),
      });
      return { id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      await ctx.db.delete(schema.stalwartIntegrations).where(eq(schema.stalwartIntegrations.id, input.id));
      return { ok: true };
    }),

  test: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await assertOwned(ctx, input.id);
      const token = decryptJSON<string>(row.encryptedToken);
      const client = new StalwartClient({ baseUrl: row.baseUrl, token, timeoutMs: 4000 });
      const summary = await client.fetchSnapshotSummary();
      await ctx.db
        .update(schema.stalwartIntegrations)
        .set({ status: summary.error ? 'error' : 'ok', lastError: summary.error ?? null, lastPulledAt: new Date() })
        .where(eq(schema.stalwartIntegrations.id, row.id));
      return { ok: !summary.error, error: summary.error, sample: summary.raw };
    }),

  pullNow: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      await pullStalwartForIntegration(input.id);
      return { ok: true };
    }),

  current: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      const [row] = await ctx.db
        .select()
        .from(schema.stalwartSnapshots)
        .where(eq(schema.stalwartSnapshots.integrationId, input.id))
        .orderBy(desc(schema.stalwartSnapshots.recordedAt))
        .limit(1);
      return row ?? null;
    }),

  history: protectedProcedure
    .input(z.object({ id: z.string(), hours: z.number().min(1).max(168).default(24) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
      return ctx.db
        .select()
        .from(schema.stalwartSnapshots)
        .where(and(
          eq(schema.stalwartSnapshots.integrationId, input.id),
          gte(schema.stalwartSnapshots.recordedAt, since),
        ))
        .orderBy(desc(schema.stalwartSnapshots.recordedAt));
    }),

  events: protectedProcedure
    .input(z.object({ id: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      return ctx.db
        .select()
        .from(schema.stalwartEvents)
        .where(eq(schema.stalwartEvents.integrationId, input.id))
        .orderBy(desc(schema.stalwartEvents.occurredAt))
        .limit(input.limit);
    }),

  webhookConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await assertOwned(ctx, input.id);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      return {
        url: `${appUrl.replace(/\/$/, '')}/api/webhooks/stalwart/${row.id}`,
        secret: row.webhookSecret,
        header: 'X-MxWatch-Signature',
        hmacAlgorithm: 'sha256',
      };
    }),
});

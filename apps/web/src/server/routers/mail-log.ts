import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { generateApiToken } from '@/lib/api-tokens';

async function assertOwned(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const mailLogRouter = router({
  listEvents: protectedProcedure
    .input(z.object({ domainId: z.string(), limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      return ctx.db
        .select()
        .from(schema.mailEvents)
        .where(eq(schema.mailEvents.domainId, input.domainId))
        .orderBy(desc(schema.mailEvents.receivedAt))
        .limit(input.limit);
    }),

  eventsByIp: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      ip: z.string().min(1),
      days: z.number().min(1).max(90).default(30),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      return ctx.db
        .select()
        .from(schema.mailEvents)
        .where(and(
          eq(schema.mailEvents.domainId, input.domainId),
          eq(schema.mailEvents.remoteIp, input.ip),
          gte(schema.mailEvents.receivedAt, since),
        ))
        .orderBy(desc(schema.mailEvents.receivedAt))
        .limit(input.limit);
    }),

  listTokens: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const rows = await ctx.db
        .select({
          id: schema.domainApiTokens.id,
          label: schema.domainApiTokens.label,
          tokenPrefix: schema.domainApiTokens.tokenPrefix,
          scope: schema.domainApiTokens.scope,
          createdAt: schema.domainApiTokens.createdAt,
          lastUsedAt: schema.domainApiTokens.lastUsedAt,
          revokedAt: schema.domainApiTokens.revokedAt,
        })
        .from(schema.domainApiTokens)
        .where(eq(schema.domainApiTokens.domainId, input.domainId))
        .orderBy(desc(schema.domainApiTokens.createdAt));
      return rows;
    }),

  createToken: protectedProcedure
    .input(z.object({ domainId: z.string(), label: z.string().max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const t = generateApiToken();
      const id = nanoid();
      await ctx.db.insert(schema.domainApiTokens).values({
        id,
        domainId: input.domainId,
        label: input.label ?? null,
        tokenHash: t.hash,
        tokenPrefix: t.displayPrefix,
        scope: 'logs.ingest',
        createdAt: new Date(),
      });
      return { id, plaintext: t.plaintext, displayPrefix: t.displayPrefix };
    }),

  revokeToken: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ tok: schema.domainApiTokens, userId: schema.domains.userId })
        .from(schema.domainApiTokens)
        .innerJoin(schema.domains, eq(schema.domainApiTokens.domainId, schema.domains.id))
        .where(eq(schema.domainApiTokens.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.domainApiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.domainApiTokens.id, input.id));
      return { ok: true };
    }),
});

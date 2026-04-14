import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { generateApiToken } from '@/lib/api-tokens';

export const settingsRouter = router({
  smtpConfig: protectedProcedure.query(() => {
    const port = Number(process.env.SMTP_PORT ?? 2525);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    let hostname: string;
    try {
      hostname = new URL(appUrl).hostname;
    } catch {
      hostname = 'localhost';
    }
    return {
      port,
      hostname,
      listenerAddress: `${hostname}:${port}`,
      suggestedLocalPart: 'reports',
      disabled: process.env.MXWATCH_DISABLE_SMTP === '1',
    };
  }),

  listApiTokens: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: schema.userApiTokens.id,
        label: schema.userApiTokens.label,
        tokenPrefix: schema.userApiTokens.tokenPrefix,
        scope: schema.userApiTokens.scope,
        createdAt: schema.userApiTokens.createdAt,
        lastUsedAt: schema.userApiTokens.lastUsedAt,
        revokedAt: schema.userApiTokens.revokedAt,
      })
      .from(schema.userApiTokens)
      .where(eq(schema.userApiTokens.userId, ctx.user.id))
      .orderBy(desc(schema.userApiTokens.createdAt));
  }),

  createApiToken: protectedProcedure
    .input(z.object({ label: z.string().max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      const t = generateApiToken();
      const id = nanoid();
      await ctx.db.insert(schema.userApiTokens).values({
        id,
        userId: ctx.user.id,
        label: input.label ?? null,
        tokenHash: t.hash,
        tokenPrefix: t.displayPrefix,
        scope: 'api.read',
        createdAt: new Date(),
      });
      return { id, plaintext: t.plaintext, displayPrefix: t.displayPrefix };
    }),

  revokeApiToken: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.userApiTokens)
        .where(eq(schema.userApiTokens.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.userApiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.userApiTokens.id, input.id));
      return { ok: true };
    }),
});

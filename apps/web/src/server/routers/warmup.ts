import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { computeProgress } from '@/lib/warmup';

export const warmupRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const plans = await ctx.db
      .select()
      .from(schema.ipWarmups)
      .where(eq(schema.ipWarmups.userId, ctx.user.id))
      .orderBy(desc(schema.ipWarmups.createdAt));

    // Sum of outbound mail_events per IP over the last 24h, scoped to this user's domains.
    const userDomains = await ctx.db
      .select({ id: schema.domains.id })
      .from(schema.domains)
      .where(eq(schema.domains.userId, ctx.user.id));
    const domainIds = userDomains.map((d) => d.id);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const countsByIp = new Map<string, number>();
    if (domainIds.length > 0) {
      const rows = await ctx.db
        .select({
          ip: schema.mailEvents.remoteIp,
          c: sql<number>`count(*)`,
        })
        .from(schema.mailEvents)
        .where(and(
          inArray(schema.mailEvents.domainId, domainIds),
          eq(schema.mailEvents.direction, 'outbound'),
          gte(schema.mailEvents.receivedAt, since),
        ))
        .groupBy(schema.mailEvents.remoteIp);
      for (const r of rows) if (r.ip) countsByIp.set(r.ip, Number(r.c));
    }

    return plans.map((p) => {
      const progress = computeProgress(p.startDate, p.planDays, p.targetDailyVolume);
      const actualToday = countsByIp.get(p.ipAddress) ?? 0;
      const utilisation = progress.todayTarget > 0 ? actualToday / progress.todayTarget : null;
      return {
        ...p,
        progress,
        actualToday,
        utilisation, // 1.0 = on target, >1 = over, <1 = under
      };
    });
  }),

  create: protectedProcedure
    .input(z.object({
      ipAddress: z.string().ip(),
      label: z.string().max(100).optional(),
      startDate: z.coerce.date().optional(),
      planDays: z.number().int().min(1).max(180).default(30),
      targetDailyVolume: z.number().int().min(1).max(10_000_000),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.ipWarmups)
        .where(and(
          eq(schema.ipWarmups.userId, ctx.user.id),
          eq(schema.ipWarmups.ipAddress, input.ipAddress),
        ))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'A warm-up plan for this IP already exists' });

      const id = nanoid();
      await ctx.db.insert(schema.ipWarmups).values({
        id,
        userId: ctx.user.id,
        ipAddress: input.ipAddress,
        label: input.label ?? null,
        startDate: input.startDate ?? new Date(),
        planDays: input.planDays,
        targetDailyVolume: input.targetDailyVolume,
        notes: input.notes ?? null,
        createdAt: new Date(),
      });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      label: z.string().max(100).nullable().optional(),
      startDate: z.coerce.date().optional(),
      planDays: z.number().int().min(1).max(180).optional(),
      targetDailyVolume: z.number().int().min(1).max(10_000_000).optional(),
      notes: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.ipWarmups)
        .where(and(eq(schema.ipWarmups.id, input.id), eq(schema.ipWarmups.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const { id, ...rest } = input;
      await ctx.db.update(schema.ipWarmups).set(rest).where(eq(schema.ipWarmups.id, id));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.ipWarmups)
        .where(and(eq(schema.ipWarmups.id, input.id), eq(schema.ipWarmups.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.delete(schema.ipWarmups).where(eq(schema.ipWarmups.id, input.id));
      return { ok: true };
    }),
});

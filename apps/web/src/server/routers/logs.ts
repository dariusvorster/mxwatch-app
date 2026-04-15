import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, logger, setLogLevel } from '@mxwatch/db';
import { and, desc, eq, gte, lte, like, or, inArray, sql, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Returns the set of domain IDs owned by the user — used to scope log rows. */
async function ownedDomainIds(ctx: any): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: schema.domains.id })
    .from(schema.domains)
    .where(eq(schema.domains.userId, ctx.user.id));
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Build the visibility filter for log/job rows: rows the user owns
 * (userId / domainId) plus system rows (both null). For single-tenant
 * self-host deployments this matches the user's expectation that "my
 * logs" includes the system banner + all their domain work.
 */
function visibilityFilter(ctx: any, ownedIds: string[]) {
  const clauses = [eq(schema.appLogs.userId, ctx.user.id)];
  if (ownedIds.length > 0) clauses.push(inArray(schema.appLogs.domainId, ownedIds));
  clauses.push(and(isNull(schema.appLogs.userId), isNull(schema.appLogs.domainId))!);
  return or(...clauses);
}

export const logsRouter = router({
  list: protectedProcedure
    .input(z.object({
      level: z.enum(LEVELS).optional(),
      category: z.string().max(40).optional(),
      domainId: z.string().optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).max(10_000).default(0),
      from: z.date().optional(),
      to: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const ownedIds = await ownedDomainIds(ctx);
      const conditions = [visibilityFilter(ctx, ownedIds)!];
      if (input.level) conditions.push(eq(schema.appLogs.level, input.level));
      if (input.category) conditions.push(eq(schema.appLogs.category, input.category));
      if (input.domainId) conditions.push(eq(schema.appLogs.domainId, input.domainId));
      if (input.search) conditions.push(like(schema.appLogs.message, `%${input.search}%`));
      if (input.from) conditions.push(gte(schema.appLogs.createdAt, input.from));
      if (input.to) conditions.push(lte(schema.appLogs.createdAt, input.to));
      return ctx.db
        .select()
        .from(schema.appLogs)
        .where(and(...conditions))
        .orderBy(desc(schema.appLogs.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  byDomain: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      limit: z.number().int().min(1).max(200).default(50),
      level: z.enum(LEVELS).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const [owned] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });
      const conditions = [eq(schema.appLogs.domainId, input.domainId)];
      if (input.level) conditions.push(eq(schema.appLogs.level, input.level));
      return ctx.db
        .select()
        .from(schema.appLogs)
        .where(and(...conditions))
        .orderBy(desc(schema.appLogs.createdAt))
        .limit(input.limit);
    }),

  jobRuns: protectedProcedure
    .input(z.object({
      domainId: z.string().optional(),
      jobName: z.string().max(80).optional(),
      status: z.enum(['running', 'success', 'partial', 'failed']).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const ownedIds = await ownedDomainIds(ctx);
      const visibility = [isNull(schema.jobRuns.domainId)];
      if (ownedIds.length > 0) visibility.push(inArray(schema.jobRuns.domainId, ownedIds));
      const conditions = [or(...visibility)!];
      if (input.domainId) conditions.push(eq(schema.jobRuns.domainId, input.domainId));
      if (input.jobName) conditions.push(eq(schema.jobRuns.jobName, input.jobName));
      if (input.status) conditions.push(eq(schema.jobRuns.status, input.status));
      return ctx.db
        .select()
        .from(schema.jobRuns)
        .where(and(...conditions))
        .orderBy(desc(schema.jobRuns.startedAt))
        .limit(input.limit);
    }),

  /** 24h error counts per category — dashboard badge uses the total. */
  errorSummary: protectedProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const ownedIds = await ownedDomainIds(ctx);
    const rows = await ctx.db
      .select({
        category: schema.appLogs.category,
        count: sql<number>`count(*)`,
      })
      .from(schema.appLogs)
      .where(and(
        eq(schema.appLogs.level, 'error'),
        gte(schema.appLogs.createdAt, since),
        visibilityFilter(ctx, ownedIds),
      ))
      .groupBy(schema.appLogs.category);
    const byCategory = Object.fromEntries(rows.map((r) => [r.category, Number(r.count)]));
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    return { total, byCategory };
  }),

  /** NDJSON export of the user's logs over a date range. Server returns a
   *  string the client turns into a Blob; no streaming needed at current
   *  volumes. Caps at 50k rows. */
  download: protectedProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(async ({ ctx, input }) => {
      const ownedIds = await ownedDomainIds(ctx);
      const rows = await ctx.db
        .select()
        .from(schema.appLogs)
        .where(and(
          gte(schema.appLogs.createdAt, input.from),
          lte(schema.appLogs.createdAt, input.to),
          visibilityFilter(ctx, ownedIds),
        ))
        .orderBy(schema.appLogs.createdAt)
        .limit(50_000);
      return rows.map((r) => JSON.stringify({
        ts: r.createdAt.toISOString(),
        level: r.level,
        category: r.category,
        message: r.message,
        domainId: r.domainId,
        durationMs: r.durationMs,
        error: r.error,
        detail: r.detail ? JSON.parse(r.detail) : undefined,
      })).join('\n');
    }),

  // ─── Log level ─────────────────────────────────────────────────
  logLevelGet: protectedProcedure.query(async ({ ctx }) => {
    const [u] = await ctx.db
      .select({ logLevel: schema.users.logLevel })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.user.id))
      .limit(1);
    return (u?.logLevel ?? 'info') as typeof LEVELS[number];
  }),

  logLevelSet: protectedProcedure
    .input(z.enum(LEVELS))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.users)
        .set({ logLevel: input, updatedAt: new Date() })
        .where(eq(schema.users.id, ctx.user.id));
      // Mirror into the running logger so subsequent writes respect the
      // new threshold immediately without a restart.
      setLogLevel(input);
      void logger.info('system', 'Log level changed', { userId: ctx.user.id, newLevel: input });
      return { ok: true };
    }),
});

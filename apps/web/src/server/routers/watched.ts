import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { runWatchedCheck } from '@/lib/run-watched-check';

const domainRegex = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

async function assertOwned(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.watchedDomains)
    .where(and(eq(schema.watchedDomains.id, id), eq(schema.watchedDomains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const watchedRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const watched = await ctx.db
      .select()
      .from(schema.watchedDomains)
      .where(eq(schema.watchedDomains.userId, ctx.user.id))
      .orderBy(desc(schema.watchedDomains.createdAt));
    if (watched.length === 0) return [];

    const ids = watched.map((w) => w.id);
    const latestRows = await ctx.db
      .select({
        watchedDomainId: schema.watchedDomainSnapshots.watchedDomainId,
        checkedAt: schema.watchedDomainSnapshots.checkedAt,
        mxRecords: schema.watchedDomainSnapshots.mxRecords,
        resolvedIp: schema.watchedDomainSnapshots.resolvedIp,
        dmarcRecord: schema.watchedDomainSnapshots.dmarcRecord,
        dmarcPolicy: schema.watchedDomainSnapshots.dmarcPolicy,
        dmarcValid: schema.watchedDomainSnapshots.dmarcValid,
        rblListedCount: schema.watchedDomainSnapshots.rblListedCount,
        rblListedOn: schema.watchedDomainSnapshots.rblListedOn,
        rn: sql<number>`row_number() over (partition by ${schema.watchedDomainSnapshots.watchedDomainId} order by ${schema.watchedDomainSnapshots.checkedAt} desc)`,
      })
      .from(schema.watchedDomainSnapshots)
      .where(inArray(schema.watchedDomainSnapshots.watchedDomainId, ids));

    const latestByDomain = new Map<string, {
      checkedAt: Date;
      mx: string[];
      resolvedIp: string | null;
      dmarcRecord: string | null;
      dmarcPolicy: string | null;
      dmarcValid: boolean | null;
      rblListedCount: number | null;
      rblListedOn: string[];
    }>();
    for (const r of latestRows) {
      if (Number(r.rn) !== 1) continue;
      latestByDomain.set(r.watchedDomainId, {
        checkedAt: r.checkedAt,
        mx: r.mxRecords ? (JSON.parse(r.mxRecords) as string[]) : [],
        resolvedIp: r.resolvedIp,
        dmarcRecord: r.dmarcRecord,
        dmarcPolicy: r.dmarcPolicy,
        dmarcValid: r.dmarcValid,
        rblListedCount: r.rblListedCount,
        rblListedOn: r.rblListedOn ? (JSON.parse(r.rblListedOn) as string[]) : [],
      });
    }

    return watched.map((w) => ({ ...w, latest: latestByDomain.get(w.id) ?? null }));
  }),

  add: protectedProcedure
    .input(z.object({
      domain: z.string().trim().toLowerCase().regex(domainRegex, 'Invalid domain'),
      label: z.string().trim().max(100).optional(),
      notes: z.string().max(500).optional(),
      alertOnRblListing: z.boolean().default(true),
      alertOnDmarcChange: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.watchedDomains)
        .where(and(
          eq(schema.watchedDomains.userId, ctx.user.id),
          eq(schema.watchedDomains.domain, input.domain),
        ))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Already watching this domain' });

      const id = nanoid();
      await ctx.db.insert(schema.watchedDomains).values({
        id,
        userId: ctx.user.id,
        domain: input.domain,
        label: input.label ?? null,
        notes: input.notes ?? null,
        alertOnRblListing: input.alertOnRblListing,
        alertOnDmarcChange: input.alertOnDmarcChange,
        createdAt: new Date(),
      });
      // Fire first check inline so the list shows real data immediately.
      try { await runWatchedCheck(id); }
      catch (e) { console.error('[watched.add] first check failed', e); }
      return { id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      await ctx.db.delete(schema.watchedDomains).where(eq(schema.watchedDomains.id, input.id));
      return { ok: true };
    }),

  runNow: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      return runWatchedCheck(input.id);
    }),
});

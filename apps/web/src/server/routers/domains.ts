import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, eq, desc, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { insertDefaultAlertRules, evaluateAlertsForDomain } from '../alert-evaluator';
import { runDnsCheckForDomain } from '@/lib/run-dns-check';
import { sql } from 'drizzle-orm';

const domainRegex = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export const domainsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.userId, ctx.user.id))
      .orderBy(desc(schema.domains.addedAt));
    return rows;
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.id), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: protectedProcedure
    .input(z.object({
      domain: z.string().trim().toLowerCase().regex(domainRegex, 'Invalid domain'),
      notes: z.string().max(500).optional(),
      dkimSelector: z.string().trim().min(1).max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.domains).values({
        id,
        userId: ctx.user.id,
        domain: input.domain,
        addedAt: new Date(),
        isActive: true,
        notes: input.notes ?? null,
      });
      if (input.dkimSelector) {
        await ctx.db.insert(schema.dkimSelectors).values({
          id: nanoid(),
          domainId: id,
          selector: input.dkimSelector,
          addedAt: new Date(),
        });
      }
      await ctx.db.insert(schema.checkSchedules).values({
        id: nanoid(),
        domainId: id,
        dnsIntervalMinutes: 60,
        blacklistIntervalMinutes: 360,
      });
      await insertDefaultAlertRules(id);
      // Fire first DNS check inline so the dashboard card isn't empty.
      // Skip alert evaluation here (no prior snapshot to diff against).
      try {
        await runDnsCheckForDomain(id);
      } catch (e) {
        console.error('[domains.create] first DNS check failed', e);
      }
      return { id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.id), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.delete(schema.domains).where(eq(schema.domains.id, input.id));
      return { ok: true };
    }),

  selectors: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(schema.dkimSelectors)
        .where(eq(schema.dkimSelectors.domainId, input.domainId));
    }),

  addSelector: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      selector: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Only letters, digits, _ and - allowed'),
    }))
    .mutation(async ({ ctx, input }) => {
      const [owned] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });

      const existing = await ctx.db
        .select()
        .from(schema.dkimSelectors)
        .where(and(
          eq(schema.dkimSelectors.domainId, input.domainId),
          eq(schema.dkimSelectors.selector, input.selector),
        ))
        .limit(1);
      if (existing.length > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Selector already added' });

      const id = nanoid();
      await ctx.db.insert(schema.dkimSelectors).values({
        id,
        domainId: input.domainId,
        selector: input.selector,
        addedAt: new Date(),
      });
      return { id };
    }),

  setSendingIp: protectedProcedure
    .input(z.object({
      id: z.string(),
      ip: z.union([z.string().ip(), z.literal('')]),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.id), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.domains)
        .set({ sendingIp: input.ip === '' ? null : input.ip })
        .where(eq(schema.domains.id, input.id));
      return { ok: true };
    }),

  suggestSendingIp: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [owned] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await ctx.db
        .select({
          ip: schema.mailEvents.remoteIp,
          count: sql<number>`count(*)`,
        })
        .from(schema.mailEvents)
        .where(and(
          eq(schema.mailEvents.domainId, input.domainId),
          eq(schema.mailEvents.direction, 'outbound'),
          gte(schema.mailEvents.receivedAt, since),
        ))
        .groupBy(schema.mailEvents.remoteIp)
        .orderBy(sql`count(*) desc`)
        .limit(5);
      return rows
        .filter((r) => r.ip)
        .map((r) => ({ ip: r.ip as string, count: Number(r.count) }));
    }),

  removeSelector: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ sel: schema.dkimSelectors, userId: schema.domains.userId })
        .from(schema.dkimSelectors)
        .innerJoin(schema.domains, eq(schema.dkimSelectors.domainId, schema.domains.id))
        .where(eq(schema.dkimSelectors.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.delete(schema.dkimSelectors).where(eq(schema.dkimSelectors.id, input.id));
      return { ok: true };
    }),
});

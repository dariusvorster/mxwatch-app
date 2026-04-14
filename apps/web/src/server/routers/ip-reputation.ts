import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

async function assertOwned(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

/** Per spec: reputationScore = 100 - (listedCount * 12), clamped to [0, 100]. */
function scoreFor(listedCount: number): number {
  return Math.max(0, Math.min(100, 100 - listedCount * 12));
}

function parseListed(listedOn: string | null): string[] {
  if (!listedOn) return [];
  try { return JSON.parse(listedOn) as string[]; } catch { return []; }
}

export const ipReputationRouter = router({
  current: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const [latest] = await ctx.db
        .select()
        .from(schema.blacklistChecks)
        .where(eq(schema.blacklistChecks.domainId, input.domainId))
        .orderBy(desc(schema.blacklistChecks.checkedAt))
        .limit(1);
      if (!latest) return null;
      const listed = parseListed(latest.listedOn);
      return {
        ip: latest.ipAddress,
        score: scoreFor(listed.length),
        listedOn: listed,
        checkedAt: latest.checkedAt,
      };
    }),

  history: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      days: z.number().int().min(1).max(365).default(90),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await ctx.db
        .select()
        .from(schema.blacklistChecks)
        .where(and(
          eq(schema.blacklistChecks.domainId, input.domainId),
          gte(schema.blacklistChecks.checkedAt, since),
        ))
        .orderBy(asc(schema.blacklistChecks.checkedAt));
      return rows.map((r) => {
        const listed = parseListed(r.listedOn);
        return {
          checkedAt: r.checkedAt,
          ip: r.ipAddress,
          listedCount: listed.length,
          listedOn: listed,
          score: scoreFor(listed.length),
        };
      });
    }),

  incidents: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      days: z.number().int().min(1).max(365).default(90),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await ctx.db
        .select()
        .from(schema.blacklistChecks)
        .where(and(
          eq(schema.blacklistChecks.domainId, input.domainId),
          gte(schema.blacklistChecks.checkedAt, since),
        ))
        .orderBy(asc(schema.blacklistChecks.checkedAt));

      // Fold the per-check snapshots into one incident per (rbl, contiguous run).
      type Incident = { rbl: string; ip: string | null; start: Date; end: Date | null; durationMs: number | null };
      const open = new Map<string, { start: Date; ip: string | null }>();
      const incidents: Incident[] = [];

      for (const r of rows) {
        const listed = new Set(parseListed(r.listedOn));
        // Close RBLs that were open but aren't listed anymore
        for (const [rbl, info] of open) {
          if (!listed.has(rbl)) {
            incidents.push({
              rbl,
              ip: info.ip,
              start: info.start,
              end: r.checkedAt,
              durationMs: r.checkedAt.getTime() - info.start.getTime(),
            });
            open.delete(rbl);
          }
        }
        // Open newly-listed RBLs
        for (const rbl of listed) {
          if (!open.has(rbl)) open.set(rbl, { start: r.checkedAt, ip: r.ipAddress });
        }
      }
      // Still-active incidents
      for (const [rbl, info] of open) {
        incidents.push({ rbl, ip: info.ip, start: info.start, end: null, durationMs: null });
      }
      return incidents.sort((a, b) => b.start.getTime() - a.start.getTime());
    }),
});

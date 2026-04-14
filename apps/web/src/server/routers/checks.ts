import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { checkDomainHealth, checkIpAgainstAllBlacklists } from '@mxwatch/monitor';
import { and, desc, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { evaluateAlertsForDomain } from '../alert-evaluator';
import { runDnsCheckForDomain } from '@/lib/run-dns-check';
import { runSmtpCheckForDomain } from '@/lib/run-smtp-check';
import { runCertCheckForDomain } from '@/lib/run-cert-check';

async function loadDomain(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const checksRouter = router({
  runDns: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      const health = await runDnsCheckForDomain(domain.id);
      await evaluateAlertsForDomain(domain.id, 'dns');
      return health;
    }),

  runBlacklist: protectedProcedure
    .input(z.object({ domainId: z.string(), ip: z.string().ip() }))
    .mutation(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      const result = await checkIpAgainstAllBlacklists(input.ip);
      await ctx.db.insert(schema.blacklistChecks).values({
        id: nanoid(),
        domainId: domain.id,
        checkedAt: new Date(),
        ipAddress: input.ip,
        listedOn: JSON.stringify(result.listedOn),
        isListed: result.isListed,
      });
      await ctx.db
        .update(schema.checkSchedules)
        .set({ lastBlacklistCheck: new Date() })
        .where(eq(schema.checkSchedules.domainId, domain.id));
      await evaluateAlertsForDomain(domain.id, 'blacklist');
      return result;
    }),

  liveHealth: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      const selectors = await ctx.db
        .select()
        .from(schema.dkimSelectors)
        .where(eq(schema.dkimSelectors.domainId, domain.id));
      return checkDomainHealth(domain.domain, selectors.map((s) => s.selector));
    }),

  runSmtp: protectedProcedure
    .input(z.object({ domainId: z.string(), port: z.number().int().min(1).max(65535).default(25) }))
    .mutation(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      const result = await runSmtpCheckForDomain(domain.id, input.port);
      return result;
    }),

  latestSmtp: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadDomain(ctx, input.domainId);
      const [row] = await ctx.db
        .select()
        .from(schema.smtpChecks)
        .where(eq(schema.smtpChecks.domainId, input.domainId))
        .orderBy(desc(schema.smtpChecks.checkedAt))
        .limit(1);
      return row ?? null;
    }),

  runCerts: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      return runCertCheckForDomain(domain.id);
    }),

  latestCerts: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadDomain(ctx, input.domainId);
      // Latest result per hostname via window function.
      const rows = await ctx.db
        .select({
          id: schema.certChecks.id,
          hostname: schema.certChecks.hostname,
          port: schema.certChecks.port,
          authorized: schema.certChecks.authorized,
          issuer: schema.certChecks.issuer,
          subject: schema.certChecks.subject,
          validFrom: schema.certChecks.validFrom,
          validTo: schema.certChecks.validTo,
          daysUntilExpiry: schema.certChecks.daysUntilExpiry,
          fingerprint: schema.certChecks.fingerprint,
          altNames: schema.certChecks.altNames,
          error: schema.certChecks.error,
          checkedAt: schema.certChecks.checkedAt,
          rn: sql<number>`row_number() over (partition by ${schema.certChecks.hostname} order by ${schema.certChecks.checkedAt} desc)`,
        })
        .from(schema.certChecks)
        .where(eq(schema.certChecks.domainId, input.domainId));
      return rows
        .filter((r) => Number(r.rn) === 1)
        .map((r) => ({ ...r, altNames: r.altNames ? (JSON.parse(r.altNames) as string[]) : [] }));
    }),

  snapshotHistory: protectedProcedure
    .input(z.object({ domainId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await loadDomain(ctx, input.domainId);
      return ctx.db
        .select()
        .from(schema.dnsSnapshots)
        .where(eq(schema.dnsSnapshots.domainId, input.domainId))
        .orderBy(desc(schema.dnsSnapshots.checkedAt))
        .limit(input.limit);
    }),

  latestDns: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadDomain(ctx, input.domainId);
      const [row] = await ctx.db
        .select()
        .from(schema.dnsSnapshots)
        .where(eq(schema.dnsSnapshots.domainId, input.domainId))
        .orderBy(desc(schema.dnsSnapshots.checkedAt))
        .limit(1);
      return row ?? null;
    }),

  latestBlacklist: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await loadDomain(ctx, input.domainId);
      const rows = await ctx.db
        .select()
        .from(schema.blacklistChecks)
        .where(eq(schema.blacklistChecks.domainId, input.domainId))
        .orderBy(desc(schema.blacklistChecks.checkedAt))
        .limit(10);
      return rows;
    }),
});

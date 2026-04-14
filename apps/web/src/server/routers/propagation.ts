import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { checkPropagation, RESOLVERS } from '@mxwatch/monitor';

async function loadDomain(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const propagationRouter = router({
  resolvers: protectedProcedure.query(() => RESOLVERS),

  check: protectedProcedure
    .input(z.object({
      domainId: z.string(),
      recordType: z.enum(['TXT', 'MX', 'A', 'AAAA']),
      /** Defaults to the domain name; supply `_dmarc.{domain}` etc. for record-specific checks. */
      hostname: z.string().trim().min(1).max(253).optional(),
      /** Substring the resolver's returned values must contain to count as propagated. Optional. */
      expectedValue: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const domain = await loadDomain(ctx, input.domainId);
      const hostname = input.hostname ?? domain.domain;
      const results = await checkPropagation(hostname, input.recordType, input.expectedValue);
      return {
        hostname,
        recordType: input.recordType,
        expectedValue: input.expectedValue ?? null,
        results,
        propagatedCount: input.expectedValue
          ? results.filter((r) => r.matches).length
          : results.filter((r) => r.values.length > 0 && !r.error).length,
        totalResolvers: results.length,
      };
    }),
});

import { z } from 'zod';
import dns from 'node:dns';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { checkSmtp } from '@mxwatch/monitor';

async function resolveFirstIp(host: string): Promise<string | null> {
  try {
    const addrs = await dns.promises.resolve4(host);
    return addrs[0] ?? null;
  } catch {
    try {
      const addrs = await dns.promises.resolve6(host);
      return addrs[0] ?? null;
    } catch {
      return null;
    }
  }
}

export const onboardingRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ step: schema.users.onboardingStep })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.user.id))
      .limit(1);
    const step = row?.step ?? 0;
    return { step, complete: step >= 4 };
  }),

  setStep: protectedProcedure
    .input(z.object({ step: z.number().int().min(0).max(5) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.users)
        .set({ onboardingStep: input.step, updatedAt: new Date() })
        .where(eq(schema.users.id, ctx.user.id));
      return { ok: true };
    }),

  advance: protectedProcedure
    .input(z.object({ minStep: z.number().int().min(0).max(5) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ step: schema.users.onboardingStep })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.user.id))
        .limit(1);
      const current = row?.step ?? 0;
      if (input.minStep > current) {
        await ctx.db
          .update(schema.users)
          .set({ onboardingStep: input.minStep, updatedAt: new Date() })
          .where(eq(schema.users.id, ctx.user.id));
      }
      return { ok: true };
    }),

  detectMailServer: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.domains)
        .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      let mxRecords: string[] = [];
      try {
        const mx = await dns.promises.resolveMx(row.domain);
        mxRecords = mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.replace(/\.$/, ''));
      } catch {
        mxRecords = [];
      }

      const primaryMx = mxRecords[0] ?? null;
      const primaryIp = primaryMx ? await resolveFirstIp(primaryMx) : null;

      let banner: string | null = null;
      let tlsVersion: string | null = null;
      let responseTimeMs: number | null = null;
      if (primaryMx) {
        const smtp = await checkSmtp(primaryMx, 25, 4000);
        banner = smtp.banner ?? null;
        tlsVersion = smtp.tlsVersion ?? null;
        responseTimeMs = smtp.responseTimeMs ?? null;
      }

      let detected: 'stalwart' | 'postfix' | 'mailcow' | 'exchange' | 'unknown' = 'unknown';
      if (banner) {
        const b = banner.toLowerCase();
        if (b.includes('stalwart')) detected = 'stalwart';
        else if (b.includes('mailcow')) detected = 'mailcow';
        else if (b.includes('postfix')) detected = 'postfix';
        else if (b.includes('microsoft') || b.includes('exchange')) detected = 'exchange';
      }

      return {
        domain: row.domain,
        mxRecords,
        primaryMx,
        primaryIp,
        banner,
        tlsVersion,
        responseTimeMs,
        detectedServer: detected,
      };
    }),
});

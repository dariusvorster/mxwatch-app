import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { cloudEnabled, lemonConfigured } from '@/lib/cloud-config';
import { createCheckout } from '@/lib/lemon-client';

function requireCloud() {
  if (!cloudEnabled()) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Billing is only available in cloud mode.' });
  }
}

function requireConfigured() {
  requireCloud();
  if (!lemonConfigured()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Billing provider not configured.' });
  }
}

export const billingRouter = router({
  // Always safe to call; self-hosted returns { available: false }.
  status: protectedProcedure.query(async ({ ctx }) => {
    if (!cloudEnabled()) {
      return { available: false, configured: false, subscription: null, plans: null } as const;
    }
    const [sub] = await ctx.db
      .select()
      .from(schema.lemonSubscriptions)
      .where(eq(schema.lemonSubscriptions.userId, ctx.user.id))
      .orderBy(desc(schema.lemonSubscriptions.updatedAt))
      .limit(1);

    const soloVariant = process.env.LEMONSQUEEZY_SOLO_VARIANT_ID ?? null;
    const teamsVariant = process.env.LEMONSQUEEZY_TEAMS_VARIANT_ID ?? null;

    return {
      available: true,
      configured: lemonConfigured(),
      subscription: sub ?? null,
      plans: {
        solo:  soloVariant  ? { variantId: soloVariant,  label: 'Cloud Solo',  price: '$9 / month'  } : null,
        teams: teamsVariant ? { variantId: teamsVariant, label: 'Cloud Teams', price: '$29 / month' } : null,
      },
    } as const;
  }),

  createCheckout: protectedProcedure
    .input(z.object({ tier: z.enum(['solo', 'teams']) }))
    .mutation(async ({ ctx, input }) => {
      requireConfigured();
      const variantId = input.tier === 'solo'
        ? process.env.LEMONSQUEEZY_SOLO_VARIANT_ID
        : process.env.LEMONSQUEEZY_TEAMS_VARIANT_ID;
      if (!variantId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${input.tier} variant not configured` });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const { url, id } = await createCheckout({
        variantId,
        userId: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name ?? undefined,
        successRedirect: `${appUrl.replace(/\/$/, '')}/settings/billing?checkout=success`,
      });
      return { url, id };
    }),
});

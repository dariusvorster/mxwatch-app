/** True when the deployment is running in cloud/SaaS mode. */
export function cloudEnabled(): boolean {
  return process.env.MXWATCH_CLOUD === '1';
}

/** True when LS is actually wired up (API key + store id + webhook secret). */
export function lemonConfigured(): boolean {
  return (
    !!process.env.LEMONSQUEEZY_API_KEY &&
    !!process.env.LEMONSQUEEZY_STORE_ID &&
    !!process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  );
}

export type PlanTier = 'self_hosted' | 'solo' | 'teams';

export function tierForVariantId(variantId: string | number | null | undefined): PlanTier {
  if (variantId == null) return 'self_hosted';
  const v = String(variantId);
  if (v === process.env.LEMONSQUEEZY_SOLO_VARIANT_ID) return 'solo';
  if (v === process.env.LEMONSQUEEZY_TEAMS_VARIANT_ID) return 'teams';
  return 'self_hosted';
}

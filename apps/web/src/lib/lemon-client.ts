/**
 * Minimal Lemon Squeezy client for checkout creation + subscription lookups.
 * Uses the JSON:API envelope LS requires. Only the endpoints we actually call
 * are typed.
 */

const API_BASE = 'https://api.lemonsqueezy.com/v1';

function headers(): Record<string, string> {
  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) throw new Error('LEMONSQUEEZY_API_KEY not set');
  return {
    Authorization: `Bearer ${key}`,
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}

async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Lemon Squeezy ${method} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export interface CreateCheckoutParams {
  variantId: string;
  userId: string;
  email: string;
  name?: string;
  successRedirect?: string;
}

/**
 * Creates a checkout session. `custom.user_id` is the bridge the webhook uses
 * to correlate the resulting subscription with the MxWatch user.
 */
export async function createCheckout(params: CreateCheckoutParams): Promise<{ url: string; id: string }> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId) throw new Error('LEMONSQUEEZY_STORE_ID not set');

  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: params.email,
          name: params.name,
          custom: { user_id: params.userId },
        },
        product_options: params.successRedirect
          ? { redirect_url: params.successRedirect }
          : undefined,
      },
      relationships: {
        store:   { data: { type: 'stores',   id: String(storeId) } },
        variant: { data: { type: 'variants', id: String(params.variantId) } },
      },
    },
  };
  const res = await call<{ data: { id: string; attributes: { url: string } } }>('POST', '/checkouts', payload);
  return { url: res.data.attributes.url, id: res.data.id };
}

export interface LemonSubscriptionAttrs {
  store_id: number;
  customer_id: number;
  order_id: number;
  variant_id: number;
  product_id: number;
  product_name: string;
  variant_name: string;
  status: string;
  status_formatted: string;
  renews_at: string | null;
  ends_at: string | null;
  trial_ends_at?: string | null;
  created_at: string;
  updated_at: string;
  urls: { update_payment_method: string | null; customer_portal: string | null };
}

export async function getSubscription(id: string): Promise<LemonSubscriptionAttrs> {
  const res = await call<{ data: { id: string; attributes: LemonSubscriptionAttrs } }>('GET', `/subscriptions/${id}`);
  return res.data.attributes;
}

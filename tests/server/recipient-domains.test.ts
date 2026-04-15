import { describe, it, expect } from 'vitest';
import { schema, nanoid } from '@mxwatch/db';
import { recipientDomainsRouter } from '@/server/routers/recipient-domains';
import { makeTestDb, ctxFor } from './_helpers';

async function fixture() {
  const t = makeTestDb();
  const u1 = await t.seedUser('u1@x');
  const d1 = await t.seedDomain(u1.id, 'a.com');
  const d2 = await t.seedDomain(u1.id, 'b.com');
  return { t, u1, d1, d2 };
}

async function snap(t: any, domainId: string, recipient: string, sent: number, delivered: number, period = '24h', recordedAt = new Date()) {
  await t.db.insert(schema.recipientDomainStats).values({
    id: nanoid(), domainId, recipientDomain: recipient, period,
    sent, delivered, bounced: sent - delivered, deferred: 0,
    deliveryRate: sent > 0 ? Math.round((delivered / sent) * 1000) : 0,
    recordedAt,
  });
}

describe('recipientDomains router', () => {
  it('stats collapses to the latest row per recipient and respects minSent', async () => {
    const { t, u1, d1 } = await fixture();
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date();
    await snap(t, d1.id, 'gmail.com', 100, 99, '24h', earlier);
    await snap(t, d1.id, 'gmail.com', 200, 195, '24h', later);
    await snap(t, d1.id, 'tinyprovider.com', 2, 2);

    const c = recipientDomainsRouter.createCaller(ctxFor(t.db, u1.id));
    const out = await c.stats({ domainId: d1.id, period: '24h', minSent: 5 });
    expect(out).toHaveLength(1); // tinyprovider filtered out
    expect(out[0]?.recipientDomain).toBe('gmail.com');
    expect(out[0]?.sent).toBe(200); // latest snapshot wins
  });

  it('crossStats sums across all owned source domains per recipient', async () => {
    const { t, u1, d1, d2 } = await fixture();
    await snap(t, d1.id, 'gmail.com', 100, 95);
    await snap(t, d2.id, 'gmail.com', 50, 50);
    await snap(t, d1.id, 'outlook.com', 30, 28);

    const c = recipientDomainsRouter.createCaller(ctxFor(t.db, u1.id));
    const rows = await c.crossStats({ period: '24h', minSent: 5 });
    const gmail = rows.find((r) => r.recipientDomain === 'gmail.com');
    expect(gmail?.sent).toBe(150);
    expect(gmail?.delivered).toBe(145);
    expect(gmail?.deliveryRate).toBe(967); // (145/150)*1000 rounded
    expect(rows[0]?.recipientDomain).toBe('gmail.com'); // sorted by sent desc
  });

  it('problems flags only sub-95% domains', async () => {
    const { t, u1, d1 } = await fixture();
    await snap(t, d1.id, 'great.com', 100, 99); // 99% — fine
    await snap(t, d1.id, 'bad.com', 100, 80);   // 80% — problem
    const c = recipientDomainsRouter.createCaller(ctxFor(t.db, u1.id));
    const probs = await c.problems({ domainId: d1.id });
    expect(probs.map((p) => p.recipientDomain)).toEqual(['bad.com']);
  });
});

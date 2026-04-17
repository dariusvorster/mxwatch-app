export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

function computeSig(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.stalwartIntegrations)
    .where(eq(schema.stalwartIntegrations.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.text();
  const sigHeader = req.headers.get('x-mxwatch-signature') ?? '';
  const expected = computeSig(row.webhookSecret, body);
  const ok = sigHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(sigHeader, 'hex'), Buffer.from(expected, 'hex'));
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  let payload: any;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const type = String(payload?.type ?? 'unknown');

  await db.insert(schema.stalwartEvents).values({
    id: nanoid(),
    integrationId: row.id,
    type,
    detail: JSON.stringify(payload),
    occurredAt: new Date(),
  });
  return NextResponse.json({ ok: true });
}

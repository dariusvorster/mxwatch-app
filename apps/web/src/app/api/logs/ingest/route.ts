import { NextResponse } from 'next/server';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { parseStalwartBody } from '@mxwatch/monitor/stalwart-parser';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, isWellFormedToken } from '@/lib/api-tokens';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_000_000; // 1 MB per request
const MAX_EVENTS = 500;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 });
  }
  const token = match[1].trim();
  if (!isWellFormedToken(token)) {
    return NextResponse.json({ error: 'Malformed token' }, { status: 401 });
  }

  const db = getDb();
  const [record] = await db
    .select()
    .from(schema.domainApiTokens)
    .where(and(
      eq(schema.domainApiTokens.tokenHash, hashToken(token)),
      isNull(schema.domainApiTokens.revokedAt),
    ))
    .limit(1);
  if (!record) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 });
  }

  const events = parseStalwartBody(body).slice(0, MAX_EVENTS);
  if (events.length === 0) {
    return NextResponse.json({ accepted: 0, rejected: 0, note: 'no parseable events' }, { status: 200 });
  }

  const now = new Date();
  const rawLines = splitRawLines(body);
  const rows = events.map((ev, idx) => ({
    id: nanoid(),
    domainId: record.domainId,
    receivedAt: now,
    eventTime: ev.eventTime,
    eventType: ev.eventType,
    direction: ev.direction,
    messageId: ev.messageId,
    senderAddress: ev.senderAddress,
    recipientAddress: ev.recipientAddress,
    remoteIp: ev.remoteIp,
    remoteHost: ev.remoteHost,
    resultCode: ev.resultCode,
    resultMessage: ev.resultMessage,
    rawJson: rawLines[idx] ?? null,
  }));
  await db.insert(schema.mailEvents).values(rows);

  await db
    .update(schema.domainApiTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.domainApiTokens.id, record.id));

  return NextResponse.json({ accepted: rows.length, rejected: 0 }, { status: 202 });
}

function splitRawLines(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) return [];
      return arr.map((x) => JSON.stringify(x));
    } catch { return []; }
  }
  return trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

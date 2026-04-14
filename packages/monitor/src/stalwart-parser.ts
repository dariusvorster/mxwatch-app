/**
 * Normaliser for Stalwart JSON log lines. Stalwart's event format evolves; we
 * pull a defensive set of common fields and always keep rawJson so the UI can
 * fall back and future parsers can do better without re-ingesting.
 */

export interface NormalizedMailEvent {
  eventTime: Date | null;
  eventType: string | null;
  direction: 'outbound' | 'inbound' | 'auth' | 'other';
  messageId: string | null;
  senderAddress: string | null;
  recipientAddress: string | null;
  remoteIp: string | null;
  remoteHost: string | null;
  resultCode: string | null;
  resultMessage: string | null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function directionForEvent(eventType: string | null): NormalizedMailEvent['direction'] {
  if (!eventType) return 'other';
  const e = eventType.toLowerCase();
  if (e.startsWith('delivery') || e.startsWith('queue') || e.startsWith('outgoing-report') || e.includes('outbound')) return 'outbound';
  if (e.startsWith('smtp') || e.startsWith('incoming') || e.includes('inbound')) return 'inbound';
  if (e.startsWith('auth') || e.startsWith('imap') || e.startsWith('pop3')) return 'auth';
  return 'other';
}

export function normalizeStalwartEvent(raw: unknown): NormalizedMailEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const tsStr = firstString(r, ['@timestamp', 'timestamp', 'time', 'ts']);
  const eventTime = tsStr ? safeDate(tsStr) : null;
  const eventType = firstString(r, ['event', 'event_type', 'type', 'name']);
  const messageId = firstString(r, ['message-id', 'messageId', 'message_id', 'span.message-id']);
  const senderAddress = firstString(r, ['from', 'sender', 'mail-from', 'mail_from', 'span.from']);
  const recipientAddress = firstString(r, ['to', 'rcpt', 'rcpt-to', 'rcpt_to', 'span.to']);
  const remoteIp = firstString(r, ['remote-ip', 'remote_ip', 'span.remote.ip', 'remote.ip', 'ip']);
  const remoteHost = firstString(r, ['remote-host', 'remote_host', 'span.remote.host', 'remote.host', 'hostname']);
  const resultCode = firstString(r, ['code', 'result-code', 'smtp-code', 'status']);
  const resultMessage = firstString(r, ['message', 'reason', 'error', 'description']);

  return {
    eventTime,
    eventType,
    direction: directionForEvent(eventType),
    messageId,
    senderAddress,
    recipientAddress,
    remoteIp,
    remoteHost,
    resultCode,
    resultMessage,
  };
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Accepts either a single object, an array of objects, or NDJSON (newline-
 * separated JSON objects) and returns normalized events.
 */
export function parseStalwartBody(body: string): NormalizedMailEvent[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  // NDJSON heuristic: no leading [ or {,\n-separated chunks
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.map(normalizeStalwartEvent).filter((e): e is NormalizedMailEvent => !!e);
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith('{') && !trimmed.includes('\n')) {
    const one = tryJson(trimmed);
    const n = one ? normalizeStalwartEvent(one) : null;
    return n ? [n] : [];
  }
  // NDJSON
  const out: NormalizedMailEvent[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const obj = tryJson(l);
    const n = obj ? normalizeStalwartEvent(obj) : null;
    if (n) out.push(n);
  }
  return out;
}

function tryJson(s: string): unknown | null {
  try { return JSON.parse(s); } catch { return null; }
}

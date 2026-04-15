import { RBL_KNOWLEDGE } from './rbl-knowledge';

export interface DraftServerInfo {
  mailHostname?: string | null;
  sendingIp?: string | null;
  ptrRecord?: string | null;
  spfStatus?: string | null;
  dkimValid?: boolean | null;
  dmarcPolicy?: string | null;
  serverType?: string | null;
}

/**
 * Generates a delist request via the Anthropic API. Cloud-only — the
 * caller must gate on MXWATCH_CLOUD + plan before invoking. Never export
 * ANTHROPIC_API_KEY to the client; this function only runs in Node.
 */
export async function draftDelistRequest(params: {
  rblName: string;
  domain: string;
  listedValue: string;
  serverInfo: DraftServerInfo;
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const rbl = RBL_KNOWLEDGE[params.rblName];
  if (!rbl) throw new Error(`Unknown RBL: ${params.rblName}`);

  const info = params.serverInfo;
  const prompt = `You are drafting a professional email/form submission to request
removal from an email blacklist.

Blacklist: ${rbl.name}
Listed value: ${params.listedValue} (${rbl.type})
Delist method: ${rbl.delistMethod}

Known server details:
- Domain: ${params.domain}
- Mail hostname: ${info.mailHostname ?? 'unknown'}
- IP: ${info.sendingIp ?? params.listedValue}
- PTR record: ${info.ptrRecord ?? 'not checked'}
- SPF status: ${info.spfStatus ?? 'unknown'}
- DKIM configured: ${info.dkimValid ? 'yes' : 'unknown'}
- DMARC policy: ${info.dmarcPolicy ?? 'unknown'}
- Mail server software: ${info.serverType ?? 'unknown'}

Write a professional, concise delist request that:
1. Clearly identifies the listed IP/domain
2. Explains this is a legitimate mail server
3. Provides the server details above
4. States steps taken to prevent future issues
5. Is polite and to the point (under 200 words)
6. Does NOT make excuses or blame others

Return ONLY the email/form text, no commentary. Do not include a
subject line — just the body.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = await res.json() as any;
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Anthropic returned no text content');
  return text.trim();
}

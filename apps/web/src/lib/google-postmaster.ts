import { getAccessToken } from './google-oauth';

const API_BASE = 'https://gmailpostmastertools.googleapis.com/v1';

interface PmDomain {
  name: string;     // "domains/example.com"
  createTime?: string;
  permission?: string;
}

export interface RawTrafficStats {
  name?: string;
  userReportedSpamRatio?: number;
  ipReputations?: Array<{ reputation: string; ipCount?: string | number }>;
  domainReputation?: string;
  dkimSuccessRatio?: number;
  spfSuccessRatio?: number;
  dmarcSuccessRatio?: number;
  inboundEncryptionRatio?: number;
  outboundEncryptionRatio?: number;
  deliveryErrors?: Array<{ errorType: string; errorClass: string; errorRatio?: number }>;
}

async function call<T>(userId: string, path: string): Promise<T> {
  const token = await getAccessToken(userId);
  if (!token) throw new Error('No Google access token — not connected');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Postmaster API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function listVerifiedDomains(userId: string): Promise<string[]> {
  const data = await call<{ domains?: PmDomain[] }>(userId, '/domains');
  return (data.domains ?? []).map((d) => d.name.replace(/^domains\//, ''));
}

/** date is YYYYMMDD (Google's format). */
export async function getTrafficStats(userId: string, domain: string, date: string): Promise<RawTrafficStats | null> {
  try {
    return await call<RawTrafficStats>(userId, `/domains/${encodeURIComponent(domain)}/trafficStats/${date}`);
  } catch (e: any) {
    // Google returns 404 when the day's stats aren't ready yet.
    if (/\b404\b/.test(e?.message ?? '')) return null;
    throw e;
  }
}

export interface NormalizedStats {
  spamRate: string | null;
  ipReputations: { bad: number; low: number; medium: number; high: number } | null;
  domainReputation: string | null;
  dkimSuccessRatio: string | null;
  spfSuccessRatio: string | null;
  dmarcSuccessRatio: string | null;
  inboundEncryptionRatio: string | null;
  outboundEncryptionRatio: string | null;
  deliveryErrors: RawTrafficStats['deliveryErrors'] | null;
}

export function normalizeStats(raw: RawTrafficStats): NormalizedStats {
  const rep = { bad: 0, low: 0, medium: 0, high: 0 };
  for (const r of raw.ipReputations ?? []) {
    const n = typeof r.ipCount === 'string' ? Number(r.ipCount) : (r.ipCount ?? 0);
    const k = r.reputation?.toLowerCase() as keyof typeof rep;
    if (k in rep) rep[k] = n;
  }
  const anyIp = rep.bad + rep.low + rep.medium + rep.high > 0;
  return {
    spamRate: raw.userReportedSpamRatio != null ? String(raw.userReportedSpamRatio) : null,
    ipReputations: anyIp ? rep : null,
    domainReputation: raw.domainReputation ?? null,
    dkimSuccessRatio: raw.dkimSuccessRatio != null ? String(raw.dkimSuccessRatio) : null,
    spfSuccessRatio: raw.spfSuccessRatio != null ? String(raw.spfSuccessRatio) : null,
    dmarcSuccessRatio: raw.dmarcSuccessRatio != null ? String(raw.dmarcSuccessRatio) : null,
    inboundEncryptionRatio: raw.inboundEncryptionRatio != null ? String(raw.inboundEncryptionRatio) : null,
    outboundEncryptionRatio: raw.outboundEncryptionRatio != null ? String(raw.outboundEncryptionRatio) : null,
    deliveryErrors: raw.deliveryErrors ?? null,
  };
}

import dns from 'node:dns';
import { RBL_KNOWLEDGE } from './rbl-knowledge';

/**
 * Pure one-shot RBL check used by the delist poller. We don't reuse
 * checkIpAgainstAllBlacklists because that sweeps every list; here we
 * want to check exactly one RBL zone against one IP/domain.
 *
 * Returns { listed, error } — any DNS error is surfaced so the caller
 * can decide whether to retry vs treat as "still listed".
 */
export async function checkSingleRBL(params: {
  value: string;
  rblHost: string;
  type: 'ip' | 'domain';
}): Promise<{ listed: boolean; error?: string }> {
  const qname = params.type === 'ip'
    ? `${params.value.split('.').reverse().join('.')}.${params.rblHost}`
    : `${params.value}.${params.rblHost}`;
  try {
    const addrs = await dns.promises.resolve4(qname);
    return { listed: addrs.length > 0 };
  } catch (e: any) {
    // NXDOMAIN is the "not listed" answer for every RBL.
    if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA') return { listed: false };
    return { listed: false, error: e?.code ?? e?.message ?? 'dns error' };
  }
}

/** Auto-expire helper — returns true when enough time has passed per the
 *  RBL's autoExpireHours relative to the provided submission time. */
export function hasAutoExpired(rblName: string, submittedAt: Date | null | undefined): boolean {
  if (!submittedAt) return false;
  const rbl = RBL_KNOWLEDGE[rblName];
  if (!rbl?.autoExpires || !rbl.autoExpireHours) return false;
  const elapsedMs = Date.now() - submittedAt.getTime();
  return elapsedMs >= rbl.autoExpireHours * 3600 * 1000;
}

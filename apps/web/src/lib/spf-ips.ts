/**
 * Minimal IPv4/IPv6 helpers for "is this source IP inside my SPF's direct
 * ip4:/ip6: mechanisms?". Does NOT resolve `include:` transitively — that
 * would require live DNS recursion. Conservative: we report an IP as
 * unexpected only when it matches none of the literal ip4/ip6 ranges.
 */

export function extractSpfRanges(spfRecord: string | null | undefined): { v4: string[]; v6: string[] } {
  const v4: string[] = [];
  const v6: string[] = [];
  if (!spfRecord) return { v4, v6 };
  for (const m of spfRecord.matchAll(/\bip4:([^\s]+)/gi)) v4.push(m[1]!);
  for (const m of spfRecord.matchAll(/\bip6:([^\s]+)/gi)) v6.push(m[1]!);
  return { v4, v6 };
}

function ip4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = (n << 8) | x;
  }
  return n >>> 0;
}

function v4CidrMatches(range: string, ip: string): boolean {
  const [base, bitsStr] = range.split('/');
  const baseInt = ip4ToInt(base!);
  const ipInt = ip4ToInt(ip);
  if (baseInt == null || ipInt == null) return false;
  const bits = bitsStr == null ? 32 : Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (~((1 << (32 - bits)) - 1)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

/** True if `ip` is covered by one of the SPF record's ip4 / ip6 literals. */
export function ipCoveredBySpf(ip: string, spfRecord: string | null | undefined): boolean {
  if (!spfRecord || !ip) return false;
  const { v4, v6 } = extractSpfRanges(spfRecord);
  const isV6 = ip.includes(':');
  if (isV6) {
    // v6 literal equality only — full CIDR match is overkill for V1.
    return v6.some((r) => r.split('/')[0]?.toLowerCase() === ip.toLowerCase());
  }
  return v4.some((r) => v4CidrMatches(r, ip));
}

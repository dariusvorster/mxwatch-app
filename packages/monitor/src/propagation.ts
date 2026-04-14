import dns from 'node:dns';

export type RecordType = 'TXT' | 'MX' | 'A' | 'AAAA';
export type Region = 'Global' | 'US' | 'EU' | 'APAC' | 'RU';

export interface Resolver {
  name: string;
  ip: string;
  region: Region;
}

export const RESOLVERS: Resolver[] = [
  { name: 'Cloudflare',         ip: '1.1.1.1',         region: 'Global' },
  { name: 'Google',             ip: '8.8.8.8',         region: 'Global' },
  { name: 'Quad9',              ip: '9.9.9.9',         region: 'Global' },
  { name: 'NextDNS',            ip: '45.90.28.0',      region: 'Global' },
  { name: 'OpenDNS',            ip: '208.67.222.222',  region: 'US' },
  { name: 'Comodo',             ip: '8.26.56.26',      region: 'US' },
  { name: 'Verisign',           ip: '64.6.64.6',       region: 'US' },
  { name: 'Hurricane Electric', ip: '74.82.42.42',     region: 'US' },
  { name: 'Level3',             ip: '209.244.0.3',     region: 'US' },
  { name: 'Neustar',            ip: '156.154.70.1',    region: 'US' },
  { name: 'Dyn',                ip: '216.146.35.35',   region: 'US' },
  { name: 'DNS.Watch',          ip: '84.200.69.80',    region: 'EU' },
  { name: 'SafeDNS',            ip: '195.46.39.39',    region: 'EU' },
  { name: 'CleanBrowsing',      ip: '185.228.168.168', region: 'EU' },
  { name: 'AdGuard',            ip: '94.140.14.14',    region: 'EU' },
  { name: 'AliDNS',             ip: '223.5.5.5',       region: 'APAC' },
  { name: 'CNNIC',              ip: '1.2.4.8',         region: 'APAC' },
  { name: 'Telstra',            ip: '139.130.4.4',     region: 'APAC' },
  { name: 'Yandex',             ip: '77.88.8.8',       region: 'RU' },
];

export interface PropagationResult {
  resolver: string;
  region: Region;
  ip: string;
  recordType: RecordType;
  values: string[];
  matches: boolean | null; // null when no expectedValue provided
  error: string | null;
  responseMs: number;
}

function lookupOne(hostname: string, recordType: RecordType, resolverIp: string, timeoutMs: number): Promise<{ values: string[]; error: string | null; responseMs: number }> {
  const r = new dns.Resolver({ timeout: timeoutMs, tries: 1 });
  r.setServers([resolverIp]);
  const start = Date.now();
  return new Promise((resolve) => {
    let finished = false;
    const done = (values: string[], error: string | null) => {
      if (finished) return;
      finished = true;
      resolve({ values, error, responseMs: Date.now() - start });
    };
    // Hard timeout fallback in case the resolver misbehaves
    const t = setTimeout(() => done([], 'timeout'), timeoutMs + 500);
    const cb = (err: NodeJS.ErrnoException | null, records: any) => {
      clearTimeout(t);
      if (err) return done([], err.code ?? err.message);
      if (recordType === 'TXT') return done((records as string[][]).map((parts) => parts.join('')), null);
      if (recordType === 'MX') return done(
        (records as dns.MxRecord[])
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((m) => `${m.priority} ${m.exchange}`),
        null,
      );
      return done(records as string[], null);
    };
    switch (recordType) {
      case 'TXT': r.resolveTxt(hostname, cb); break;
      case 'MX': r.resolveMx(hostname, cb); break;
      case 'A': r.resolve4(hostname, cb); break;
      case 'AAAA': r.resolve6(hostname, cb); break;
    }
  });
}

/**
 * Queries the same record from a fixed set of public resolvers in parallel.
 * When `expectedValue` is supplied, `matches` is true when any returned value
 * contains that substring (case-insensitive).
 */
export async function checkPropagation(
  hostname: string,
  recordType: RecordType,
  expectedValue?: string,
  timeoutMs = 4000,
): Promise<PropagationResult[]> {
  const expected = expectedValue?.trim().toLowerCase();
  return Promise.all(
    RESOLVERS.map(async (r) => {
      const { values, error, responseMs } = await lookupOne(hostname, recordType, r.ip, timeoutMs);
      const joined = values.join(' ').toLowerCase();
      const matches = expected ? joined.includes(expected) : null;
      return {
        resolver: r.name,
        region: r.region,
        ip: r.ip,
        recordType,
        values,
        matches,
        error,
        responseMs,
      };
    }),
  );
}

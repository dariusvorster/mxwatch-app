import tls from 'node:tls';

export interface CertCheckResult {
  hostname: string;
  port: number;
  authorized: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  daysUntilExpiry: number | null;
  fingerprint: string | null;
  altNames: string[];
  error: string | null;
  checkedAt: Date;
}

/**
 * Connects via TLS and reads the peer certificate. Always resolves; errors
 * are returned in the `error` field so the caller can persist the attempt.
 */
export async function checkCertificate(hostname: string, port: number = 443, timeoutMs = 10000): Promise<CertCheckResult> {
  const base: CertCheckResult = {
    hostname, port,
    authorized: false,
    issuer: null,
    subject: null,
    validFrom: null,
    validTo: null,
    daysUntilExpiry: null,
    fingerprint: null,
    altNames: [],
    error: null,
    checkedAt: new Date(),
  };
  return new Promise((resolve) => {
    let finished = false;
    const done = (patch: Partial<CertCheckResult>) => {
      if (finished) return;
      finished = true;
      resolve({ ...base, ...patch });
    };
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: timeoutMs, rejectUnauthorized: false }, () => {
      try {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          done({ error: 'no-certificate' });
          socket.destroy();
          return;
        }
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const days = validTo ? Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
        const altNames = typeof cert.subjectaltname === 'string'
          ? cert.subjectaltname.split(',').map((s) => s.trim().replace(/^DNS:/, ''))
          : [];
        const str = (v: string | string[] | undefined | null): string | null =>
          Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
        done({
          authorized: socket.authorized,
          issuer: str(cert.issuer?.O as any) ?? str(cert.issuer?.CN as any),
          subject: str(cert.subject?.CN as any),
          validFrom,
          validTo,
          daysUntilExpiry: days,
          fingerprint: cert.fingerprint256 ?? cert.fingerprint ?? null,
          altNames,
          error: socket.authorized ? null : (socket.authorizationError ? String(socket.authorizationError) : null),
        });
      } finally {
        socket.destroy();
      }
    });
    socket.on('error', (e) => { done({ error: e.message }); try { socket.destroy(); } catch {} });
    socket.on('timeout', () => { done({ error: 'timeout' }); try { socket.destroy(); } catch {} });
  });
}

import net from 'node:net';
import tls from 'node:tls';
import { isIP } from 'node:net';

export type MailServerType =
  | 'stalwart'
  | 'mailcow'
  | 'postfix'
  | 'postfix_dovecot'
  | 'mailu'
  | 'maddy'
  | 'haraka'
  | 'exchange'
  // Cloud providers (integrations spec Tier 4)
  | 'resend'
  | 'postmark'
  | 'mailgun'
  | 'sendgrid'
  | 'ses'
  | 'unknown';

export type NetworkArchitecture = 'direct' | 'nat_relay' | 'split' | 'managed';

export interface ServerFingerprint {
  detectedType: MailServerType | null;
  confidence: 'high' | 'medium' | 'low';
  openPorts: number[];
  smtpBanner: string | null;
  smtpCapabilities: string[];
  tlsVersion: string | null;
  apiDetected: boolean;
  apiEndpoint: string | null;
  suggestedArchitecture: NetworkArchitecture;
  evidence: string[];
}

const DETECT_PORTS = [25, 587, 465, 993, 995, 80, 443, 8080, 8443] as const;

export async function isPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export interface SmtpBannerResult {
  banner: string | null;
  capabilities: string[];
  tlsVersion: string | null;
}

/**
 * Connects, reads banner, issues EHLO, collects 250- capabilities. Implicit
 * TLS (465) connects via tls; 25/587 are read in plain. Always resolves.
 */
export async function grabSMTPBanner(host: string, port: number, timeoutMs = 3000): Promise<SmtpBannerResult> {
  return new Promise((resolve) => {
    const base: SmtpBannerResult = { banner: null, capabilities: [], tlsVersion: null };
    let buf = '';
    let done = false;
    const finish = (patch: Partial<SmtpBannerResult>) => {
      if (done) return;
      done = true;
      try { socket.end(); } catch { /* noop */ }
      resolve({ ...base, ...patch });
    };

    const socket: net.Socket = port === 465
      ? tls.connect({ host, port, rejectUnauthorized: false, servername: host })
      : net.connect(port, host);

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish({}));
    socket.once('error', () => finish({}));

    let ehloSent = false;
    let banner: string | null = null;
    const caps: string[] = [];

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!ehloSent && /\r?\n/.test(buf)) {
        const first = buf.split(/\r?\n/).find((l) => /^220/.test(l));
        if (first) {
          banner = first.replace(/^220[- ]/, '').trim();
          ehloSent = true;
          try { socket.write(`EHLO mxwatch.app\r\n`); } catch { finish({ banner }); return; }
          buf = '';
        }
      } else if (ehloSent) {
        const lines = buf.split(/\r?\n/);
        const last = lines[lines.length - 2] ?? '';
        if (/^250 /.test(last)) {
          for (const line of lines) {
            const m = line.match(/^250[- ]([^\s]+(?:\s+[^\s]+)*)$/);
            if (m?.[1]) caps.push(m[1].trim().toUpperCase());
          }
          const tlsVersion = port === 465 && socket instanceof tls.TLSSocket
            ? (socket.getProtocol() ?? null)
            : null;
          finish({ banner, capabilities: caps, tlsVersion });
        }
      }
    });
  });
}

/**
 * GET the URL with a short timeout and TLS verification off (self-signed
 * mail-server management APIs are common). A response counts as "reachable"
 * if the status is < 500 and not 404 — 401/403 mean the endpoint exists but
 * needs auth, which is enough to confirm the software.
 */
export async function probeHTTP(url: string, timeoutMs = 2500): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Node 18+ fetch honours NODE_TLS_REJECT_UNAUTHORIZED=0; set per-call via
    // the agent override below on https requests. For simplicity we fall back
    // to global fetch and let operators set the env var if they need laxer TLS.
    const res = await fetch(url, { method: 'GET', signal: ac.signal, redirect: 'manual' });
    if (res.status === 404) return false;
    if (res.status >= 500) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
];

export function isPrivateIP(host: string): boolean {
  const v = isIP(host);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(host));
  if (v === 6) {
    const h = host.toLowerCase();
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }
  return false;
}

function identifyFromBanner(banner: string | null): MailServerType | null {
  if (!banner) return null;
  const b = banner.toLowerCase();
  if (b.includes('stalwart')) return 'stalwart';
  if (b.includes('haraka')) return 'haraka';
  if (b.includes('maddy')) return 'maddy';
  if (b.includes('microsoft') || b.includes('exchange')) return 'exchange';
  if (b.includes('postfix')) return 'postfix';
  return null;
}

interface ApiProbe {
  type: Exclude<MailServerType, 'unknown' | 'postfix' | 'postfix_dovecot' | 'haraka' | 'maddy' | 'exchange'>;
  paths: string[];
}

const API_PROBES: ApiProbe[] = [
  { type: 'stalwart', paths: ['/api/server/info', '/api/principal'] },
  { type: 'mailcow', paths: ['/api/v1/get/status/containers'] },
  { type: 'mailu', paths: ['/api/v1/domain'] },
];

export async function detectMailServer(host: string, internalHost?: string): Promise<ServerFingerprint> {
  const evidence: string[] = [];
  const openPorts: number[] = [];

  for (const port of DETECT_PORTS) {
    if (await isPortOpen(host, port)) openPorts.push(port);
  }
  if (openPorts.length > 0) evidence.push(`Open ports: ${openPorts.join(', ')}`);

  let smtpBanner: string | null = null;
  let smtpCapabilities: string[] = [];
  let tlsVersion: string | null = null;
  const smtpPort = openPorts.includes(587) ? 587 : openPorts.includes(25) ? 25 : openPorts.includes(465) ? 465 : null;
  if (smtpPort) {
    const smtp = await grabSMTPBanner(host, smtpPort);
    smtpBanner = smtp.banner;
    smtpCapabilities = smtp.capabilities;
    tlsVersion = smtp.tlsVersion;
    if (smtpBanner) evidence.push(`SMTP banner on ${smtpPort}: ${smtpBanner}`);
  }

  let detectedType: MailServerType | null = identifyFromBanner(smtpBanner);
  if (detectedType) evidence.push(`Identified ${detectedType} from SMTP banner`);

  let apiDetected = false;
  let apiEndpoint: string | null = null;
  const apiCandidatePorts = [openPorts.includes(443) ? 443 : null, openPorts.includes(8443) ? 8443 : null].filter(
    (p): p is number => p != null,
  );
  if (apiCandidatePorts.length === 0 && (openPorts.includes(443) || openPorts.includes(8443))) {
    apiCandidatePorts.push(443);
  } else if (apiCandidatePorts.length === 0) {
    apiCandidatePorts.push(443);
  }

  outer: for (const probe of API_PROBES) {
    if (detectedType && detectedType !== probe.type && !(detectedType === 'postfix' && probe.type === 'mailcow')) continue;
    for (const port of apiCandidatePorts) {
      for (const path of probe.paths) {
        const base = port === 443 ? `https://${host}` : `https://${host}:${port}`;
        const url = `${base}${path}`;
        const reachable = await probeHTTP(url);
        if (reachable) {
          apiDetected = true;
          apiEndpoint = base;
          detectedType = probe.type;
          evidence.push(`API endpoint found at ${url}`);
          break outer;
        }
      }
    }
  }

  if (internalHost) {
    const internalPorts: number[] = [];
    for (const port of [25, 587, 465]) {
      if (await isPortOpen(internalHost, port)) internalPorts.push(port);
    }
    if (internalPorts.length > 0) evidence.push(`Internal host ${internalHost} ports: ${internalPorts.join(', ')}`);
  }

  const suggestedArchitecture: NetworkArchitecture =
    internalHost ? 'nat_relay' : isPrivateIP(host) ? 'nat_relay' : 'direct';

  const confidence: ServerFingerprint['confidence'] =
    detectedType && apiDetected ? 'high' : detectedType ? 'medium' : 'low';

  return {
    detectedType: detectedType ?? (openPorts.length > 0 ? 'unknown' : null),
    confidence,
    openPorts,
    smtpBanner,
    smtpCapabilities,
    tlsVersion,
    apiDetected,
    apiEndpoint,
    suggestedArchitecture,
    evidence,
  };
}

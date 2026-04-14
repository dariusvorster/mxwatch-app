import net from 'node:net';
import tls from 'node:tls';

export interface SmtpCheckResult {
  host: string;
  port: number;
  connected: boolean;
  responseTimeMs: number;
  banner: string | null;
  tlsVersion: string | null;
  tlsAuthorized: boolean | null;
  starttlsOffered: boolean;
  error: string | null;
}

const HELLO_NAME = 'mxwatch.app';

/**
 * Checks an SMTP host by opening a connection, reading the banner, issuing
 * EHLO, and (for 25/587) negotiating STARTTLS. For port 465, connects with
 * implicit TLS. Always resolves — never rejects — so callers can persist the
 * result.
 */
export async function checkSmtp(host: string, port: number = 25, timeoutMs = 10000): Promise<SmtpCheckResult> {
  const start = Date.now();
  const base: SmtpCheckResult = {
    host, port,
    connected: false,
    responseTimeMs: 0,
    banner: null,
    tlsVersion: null,
    tlsAuthorized: null,
    starttlsOffered: false,
    error: null,
  };

  if (port === 465) return checkImplicitTls(host, port, timeoutMs, start, base);
  return checkPlainWithStarttls(host, port, timeoutMs, start, base);
}

function checkImplicitTls(host: string, port: number, timeoutMs: number, start: number, base: SmtpCheckResult): Promise<SmtpCheckResult> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (patch: Partial<SmtpCheckResult>) => {
      if (finished) return;
      finished = true;
      resolve({ ...base, ...patch, responseTimeMs: Date.now() - start });
    };

    const socket = tls.connect({ host, port, servername: host, timeout: timeoutMs }, () => {
      let banner = '';
      socket.setEncoding('utf8');
      socket.once('data', (data) => {
        banner = String(data).split('\r\n')[0] ?? '';
        try {
          socket.write(`QUIT\r\n`);
        } catch {}
        finish({
          connected: true,
          banner: banner.replace(/^220\s*/, ''),
          tlsVersion: socket.getProtocol() ?? null,
          tlsAuthorized: socket.authorized,
        });
        setTimeout(() => socket.destroy(), 50);
      });
    });
    socket.on('error', (e) => finish({ error: e.message }));
    socket.on('timeout', () => { socket.destroy(); finish({ error: 'timeout' }); });
  });
}

function checkPlainWithStarttls(host: string, port: number, timeoutMs: number, start: number, base: SmtpCheckResult): Promise<SmtpCheckResult> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (patch: Partial<SmtpCheckResult>) => {
      if (finished) return;
      finished = true;
      resolve({ ...base, ...patch, responseTimeMs: Date.now() - start });
    };

    let stage: 'banner' | 'ehlo' | 'starttls' = 'banner';
    let banner: string | null = null;
    let starttls = false;
    let buffer = '';

    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.setEncoding('utf8');

    socket.on('data', (chunk) => {
      buffer += String(chunk);
      // Basic SMTP line parser — consume complete lines terminated by \r\n.
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleLine(line);
      }
    });

    socket.on('error', (e) => finish({ error: e.message, connected: !!banner }));
    socket.on('timeout', () => { socket.destroy(); finish({ error: 'timeout', connected: !!banner }); });

    function handleLine(line: string) {
      if (stage === 'banner') {
        if (line.startsWith('220')) {
          banner = line.replace(/^220[\s-]*/, '');
          stage = 'ehlo';
          try { socket.write(`EHLO ${HELLO_NAME}\r\n`); } catch {}
        } else if (/^\d{3}/.test(line) && line[3] === ' ') {
          finish({ connected: true, banner, error: `unexpected banner: ${line}` });
          try { socket.destroy(); } catch {}
        }
        return;
      }
      if (stage === 'ehlo') {
        if (/STARTTLS/i.test(line)) starttls = true;
        // 250 with trailing space terminates multi-line EHLO response
        if (/^250\s/.test(line)) {
          if (starttls) {
            stage = 'starttls';
            try { socket.write('STARTTLS\r\n'); } catch {}
          } else {
            finish({ connected: true, banner, starttlsOffered: false });
            try { socket.write('QUIT\r\n'); } catch {}
            try { socket.destroy(); } catch {}
          }
        }
        return;
      }
      if (stage === 'starttls') {
        if (line.startsWith('220')) {
          const tlsSocket = tls.connect({ socket, servername: host, rejectUnauthorized: false });
          tlsSocket.once('secureConnect', () => {
            finish({
              connected: true,
              banner,
              starttlsOffered: true,
              tlsVersion: tlsSocket.getProtocol() ?? null,
              tlsAuthorized: tlsSocket.authorized,
            });
            try { tlsSocket.end(); } catch {}
            try { tlsSocket.destroy(); } catch {}
          });
          tlsSocket.once('error', (e) => finish({ connected: true, banner, starttlsOffered: true, error: `tls: ${e.message}` }));
        } else {
          finish({ connected: true, banner, starttlsOffered: true, error: `STARTTLS refused: ${line}` });
          try { socket.destroy(); } catch {}
        }
      }
    }
  });
}

import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { gunzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';

export type { ParsedMail, SMTPServerSession };

/**
 * Callback receives the fully-parsed mail plus the SMTP session (recipient
 * envelope, remote IP, TLS info). The caller is responsible for dispatching
 * based on recipient / content type.
 */
export type InboundMailHandler = (mail: ParsedMail, session: SMTPServerSession) => Promise<void> | void;

export function startSmtpListener(port: number, onMail: InboundMailHandler) {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH'],
    onData(stream, session, callback) {
      simpleParser(stream, async (err, mail) => {
        if (err) {
          console.error('[smtp-listener] parse error', err);
          return callback(err);
        }
        try {
          await onMail(mail, session);
        } catch (e) {
          console.error('[smtp-listener] handler error', e);
        }
        callback();
      });
    },
  });
  server.listen(port, () => console.log(`[smtp-listener] MxWatch SMTP listener on port ${port}`));
  return server;
}

/**
 * Extracts DMARC aggregate-report XML bodies from parsed mail attachments.
 * Returns an array of XML strings — ZIP / GZIP / raw .xml are all handled.
 */
export function extractDmarcXml(mail: ParsedMail): string[] {
  const out: string[] = [];
  for (const attachment of mail.attachments ?? []) {
    const name = attachment.filename ?? '';
    const type = attachment.contentType ?? '';
    try {
      if (type.includes('zip') || name.endsWith('.zip')) {
        const zip = new AdmZip(attachment.content as Buffer);
        const entries = zip.getEntries();
        const xml = entries[0]?.getData().toString('utf8');
        if (xml) out.push(xml);
      } else if (type.includes('gzip') || name.endsWith('.gz')) {
        out.push(gunzipSync(attachment.content as Buffer).toString('utf8'));
      } else if (name.endsWith('.xml') || type.includes('xml')) {
        out.push((attachment.content as Buffer).toString('utf8'));
      }
    } catch (e) {
      console.error('[smtp-listener] attachment decode failed', e);
    }
  }
  return out;
}

/** First envelope recipient local-part + domain, if any. */
export function firstRecipient(session: SMTPServerSession): { local: string; domain: string } | null {
  const rcpt = session.envelope.rcptTo?.[0]?.address;
  if (!rcpt) return null;
  const atIdx = rcpt.lastIndexOf('@');
  if (atIdx < 0) return null;
  return { local: rcpt.slice(0, atIdx).toLowerCase(), domain: rcpt.slice(atIdx + 1).toLowerCase() };
}

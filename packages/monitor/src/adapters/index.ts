import type { MailServerType } from '../server-detect';
import type { MailServerAdapter } from './types';
import { GenericSMTPAdapter } from './generic-smtp';
import { StalwartAdapter } from './stalwart';
import { MailcowAdapter } from './mailcow';
import { PostfixAdapter } from './postfix';
import { MailuAdapter } from './mailu';
import { MaddyAdapter } from './maddy';
import { HarakaAdapter } from './haraka';
import { ResendAdapter } from './resend';
import { PostmarkAdapter } from './postmark';
import { MailgunAdapter } from './mailgun';
import { SendGridAdapter } from './sendgrid';
import { SesAdapter } from './ses';
import { MiabAdapter } from './miab';
import { PostalAdapter } from './postal';
import { ModoboaAdapter } from './modoboa';

/**
 * Registry maps detected server type → adapter implementation. As concrete
 * adapters land (Stalwart in V4 step 3, Postfix in step 4, Mailcow in step 5,
 * Mailu / Maddy / Haraka / Exchange in V4.1+) they'll replace the generic
 * fallback entry.
 */
const generic = new GenericSMTPAdapter();

export const ADAPTER_REGISTRY: Record<MailServerType, MailServerAdapter> = {
  stalwart: new StalwartAdapter(),
  mailcow: new MailcowAdapter(),
  postfix: new PostfixAdapter(),
  postfix_dovecot: new PostfixAdapter(),
  mailu: new MailuAdapter(),
  maddy: new MaddyAdapter(),
  haraka: new HarakaAdapter(),
  exchange: generic,
  resend: new ResendAdapter(),
  postmark: new PostmarkAdapter(),
  mailgun: new MailgunAdapter(),
  sendgrid: new SendGridAdapter(),
  ses: new SesAdapter(),
  miab: new MiabAdapter(),
  postal: new PostalAdapter(),
  modoboa: new ModoboaAdapter(),
  unknown: generic,
};

export function getAdapter(type: MailServerType | null | undefined): MailServerAdapter {
  if (!type) return ADAPTER_REGISTRY.unknown;
  return ADAPTER_REGISTRY[type] ?? ADAPTER_REGISTRY.unknown;
}

export * from './types';
export { GenericSMTPAdapter } from './generic-smtp';
export { StalwartAdapter } from './stalwart';
export { MailcowAdapter, parseDovecotAuthFailures } from './mailcow';
export { PostfixAdapter } from './postfix';
export { MailuAdapter } from './mailu';
export { MaddyAdapter } from './maddy';
export { HarakaAdapter } from './haraka';
export { ResendAdapter } from './resend';
export { PostmarkAdapter } from './postmark';
export { MailgunAdapter } from './mailgun';
export { SendGridAdapter } from './sendgrid';
export { SesAdapter } from './ses';
export { MiabAdapter } from './miab';
export { PostalAdapter } from './postal';
export { ModoboaAdapter } from './modoboa';
export { PostfixLogParser, parsePostfixTimestamp } from './postfix-log-parser';

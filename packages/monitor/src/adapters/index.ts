import type { MailServerType } from '../server-detect';
import type { MailServerAdapter } from './types';
import { GenericSMTPAdapter } from './generic-smtp';
import { StalwartAdapter } from './stalwart';
import { MailcowAdapter } from './mailcow';
import { PostfixAdapter } from './postfix';

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
  mailu: generic,
  maddy: generic,
  haraka: generic,
  exchange: generic,
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
export { PostfixLogParser, parsePostfixTimestamp } from './postfix-log-parser';

import type { MailServerType } from '../server-detect';
import type { MailServerAdapter } from './types';
import { GenericSMTPAdapter } from './generic-smtp';

/**
 * Registry maps detected server type → adapter implementation. As concrete
 * adapters land (Stalwart in V4 step 3, Postfix in step 4, Mailcow in step 5,
 * Mailu / Maddy / Haraka / Exchange in V4.1+) they'll replace the generic
 * fallback entry.
 */
const generic = new GenericSMTPAdapter();

export const ADAPTER_REGISTRY: Record<MailServerType, MailServerAdapter> = {
  stalwart: generic,
  mailcow: generic,
  postfix: generic,
  postfix_dovecot: generic,
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

import type {
  Alert,
  AlertChannelType,
  ChannelConfig,
  EmailChannelConfig,
  NtfyChannelConfig,
  SlackChannelConfig,
  WebhookChannelConfig,
} from '@mxwatch/types';
import { sendEmailAlert } from './email';
import { sendSlackAlert } from './slack';
import { sendNtfyAlert } from './ntfy';
import { sendWebhookAlert } from './webhook';
export { encryptJSON, decryptJSON } from './crypto';
export { sendEmailAlert, sendSlackAlert, sendNtfyAlert, sendWebhookAlert };

export interface AlertChannelRecord {
  id: string;
  type: AlertChannelType;
  config: ChannelConfig;
}

export async function sendAlert(channel: AlertChannelRecord, alert: Alert): Promise<void> {
  switch (channel.type) {
    case 'email':
      return sendEmailAlert(channel.config as EmailChannelConfig, alert);
    case 'slack':
      return sendSlackAlert(channel.config as SlackChannelConfig, alert);
    case 'ntfy':
      return sendNtfyAlert(channel.config as NtfyChannelConfig, alert);
    case 'webhook':
      return sendWebhookAlert(channel.config as WebhookChannelConfig, alert);
    default: {
      const _exhaustive: never = channel.type;
      throw new Error(`Unknown channel type: ${String(_exhaustive)}`);
    }
  }
}

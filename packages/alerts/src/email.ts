import nodemailer from 'nodemailer';
import type { Alert, EmailChannelConfig } from '@mxwatch/types';

let _transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (_transport) return _transport;
  const host = process.env.ALERT_SMTP_HOST;
  const port = Number(process.env.ALERT_SMTP_PORT ?? 587);
  const user = process.env.ALERT_SMTP_USER;
  const pass = process.env.ALERT_SMTP_PASS;
  if (!host) throw new Error('ALERT_SMTP_HOST not configured');
  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
  return _transport;
}

export async function sendEmailAlert(config: EmailChannelConfig, alert: Alert): Promise<void> {
  const from = process.env.ALERT_SMTP_FROM ?? 'mxwatch@localhost';
  const subject = `[MxWatch ${alert.severity.toUpperCase()}] ${alert.domainName}: ${alert.type}`;
  const body = [
    `Domain: ${alert.domainName}`,
    `Severity: ${alert.severity}`,
    `Type: ${alert.type}`,
    `Fired: ${alert.firedAt.toISOString()}`,
    '',
    alert.message,
  ].join('\n');
  await getTransport().sendMail({ from, to: config.to, subject, text: body });
}

import { env } from '../../config/env';
import { getMailTransport } from '../mail/transport';

export type NotificationMessage = {
  to: string;
  subject: string;
  text: string;
  event: string;
  organizationId: string;
};

// Replaceable delivery channel, mirroring the LLM/embedding provider pattern.
// Implementations: console logging (dev/test default) and a generic HTTPS
// webhook so real email/chat delivery can be attached without code changes.
export interface NotificationProvider {
  name: string;
  send(message: NotificationMessage): Promise<void>;
}

export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = 'CONSOLE';

  async send(message: NotificationMessage) {
    // eslint-disable-next-line no-console
    console.log(`[notification] ${message.event} -> ${message.to}: ${message.subject}`);
  }
}

export class WebhookNotificationProvider implements NotificationProvider {
  readonly name = 'WEBHOOK';

  constructor(private readonly url: string) {}

  async send(message: NotificationMessage) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Notification webhook returned ${res.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Delivers notifications as real email through the shared nodemailer SMTP
// transport (modules/mail). Selected when SMTP_URL is configured.
export class SmtpNotificationProvider implements NotificationProvider {
  readonly name = 'SMTP';

  async send(message: NotificationMessage) {
    await getMailTransport().send({
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export function createNotificationProvider(): NotificationProvider {
  if (env.SMTP_URL) {
    return new SmtpNotificationProvider();
  }
  if (env.NOTIFICATION_WEBHOOK_URL) {
    return new WebhookNotificationProvider(env.NOTIFICATION_WEBHOOK_URL);
  }
  return new ConsoleNotificationProvider();
}

let provider: NotificationProvider | null = null;

// Lazily resolved so tests can spy on this getter or stub env before first use.
export function getNotificationProvider(): NotificationProvider {
  if (!provider) provider = createNotificationProvider();
  return provider;
}

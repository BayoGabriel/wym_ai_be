import { env } from '../../../config/env';
import { getMailTransport } from '../../mail/transport';

// Outbound delivery abstraction for the email channel. Order of preference:
// SMTP via the shared nodemailer transport, then the SendGrid API, then log —
// so the pipeline is exercisable without credentials.
export interface EmailSender {
  name: string;
  send(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
  }): Promise<void>;
}

export class LogEmailSender implements EmailSender {
  readonly name = 'LOG';

  async send(params: { from: string; to: string; subject: string; text: string }) {
    // eslint-disable-next-line no-console
    console.log(`[email] -> ${params.to} (${params.subject}): ${params.text}`);
  }
}

export class SmtpEmailSender implements EmailSender {
  readonly name = 'SMTP';

  async send(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
  }) {
    await getMailTransport().send({
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      inReplyTo: params.inReplyTo,
    });
  }
}

export class SendGridEmailSender implements EmailSender {
  readonly name = 'SENDGRID';

  constructor(private readonly apiKey: string) {}

  async send(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.to }] }],
          from: { email: params.from },
          subject: params.subject,
          content: [{ type: 'text/plain', value: params.text }],
          ...(params.inReplyTo ? { headers: { 'In-Reply-To': params.inReplyTo } } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`SendGrid send failed (${res.status})`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEmailSender(): EmailSender {
  if (env.SMTP_URL) return new SmtpEmailSender();
  if (env.SENDGRID_API_KEY) return new SendGridEmailSender(env.SENDGRID_API_KEY);
  return new LogEmailSender();
}

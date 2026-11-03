import nodemailer from 'nodemailer';
import { env } from '../../config/env';

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  from?: string;
};

export interface MailTransport {
  name: string;
  send(mail: OutboundMail): Promise<void>;
}

export class LogMailTransport implements MailTransport {
  readonly name = 'LOG';

  async send(mail: OutboundMail) {
    // eslint-disable-next-line no-console
    console.log(`[mail] -> ${mail.to} (${mail.subject}): ${mail.text.slice(0, 160)}`);
  }
}

// SMTP transport backed by nodemailer; SMTP_URL is a standard connection URI,
// e.g. smtps://user:pass@smtp.gmail.com or smtp://localhost:1025 (MailHog).
export class SmtpMailTransport implements MailTransport {
  readonly name = 'SMTP';

  private readonly transporter = nodemailer.createTransport(env.SMTP_URL!);

  async send(mail: OutboundMail) {
    await this.transporter.sendMail({
      from: mail.from ?? env.EMAIL_FROM ?? 'no-reply@wymnet.ai',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      inReplyTo: mail.inReplyTo,
      references: mail.inReplyTo ? [mail.inReplyTo] : undefined,
    });
  }
}

export function createMailTransport(): MailTransport {
  if (env.SMTP_URL) return new SmtpMailTransport();
  return new LogMailTransport();
}

let transport: MailTransport | null = null;

// Lazily resolved so tests can stub env or swap the transport before use.
export function getMailTransport(): MailTransport {
  if (!transport) transport = createMailTransport();
  return transport;
}

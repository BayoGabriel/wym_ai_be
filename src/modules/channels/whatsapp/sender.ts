import { env } from '../../../config/env';

// Outbound delivery abstraction for the WhatsApp channel. The Meta sender is
// used when WHATSAPP_ACCESS_TOKEN is configured; otherwise deliveries are
// logged so the pipeline is exercisable without credentials.
export interface WhatsAppSender {
  name: string;
  send(params: { phoneNumberId: string; to: string; text: string }): Promise<void>;
}

export class LogWhatsAppSender implements WhatsAppSender {
  readonly name = 'LOG';

  async send(params: { phoneNumberId: string; to: string; text: string }) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp] -> ${params.to} via ${params.phoneNumberId}: ${params.text}`);
  }
}

export class MetaWhatsAppSender implements WhatsAppSender {
  readonly name = 'META';

  constructor(private readonly accessToken: string) {}

  async send(params: { phoneNumberId: string; to: string; text: string }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${params.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'text',
            text: { body: params.text.slice(0, 4096) },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        throw new Error(`WhatsApp send failed (${res.status})`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createWhatsAppSender(): WhatsAppSender {
  if (env.WHATSAPP_ACCESS_TOKEN) return new MetaWhatsAppSender(env.WHATSAPP_ACCESS_TOKEN);
  return new LogWhatsAppSender();
}

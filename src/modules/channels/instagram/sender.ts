import { env } from '../../../config/env';
import { sendMetaText } from '../meta/common';

// Outbound delivery abstraction for the Instagram channel. The Meta sender is
// used when INSTAGRAM_PAGE_ACCESS_TOKEN is configured; otherwise deliveries
// are logged so the pipeline is exercisable without credentials.
export interface InstagramSender {
  name: string;
  send(params: { recipientId: string; text: string }): Promise<void>;
}

export class LogInstagramSender implements InstagramSender {
  readonly name = 'LOG';

  async send(params: { recipientId: string; text: string }) {
    // eslint-disable-next-line no-console
    console.log(`[instagram] -> ${params.recipientId}: ${params.text}`);
  }
}

export class MetaInstagramSender implements InstagramSender {
  readonly name = 'META';

  constructor(private readonly accessToken: string) {}

  async send(params: { recipientId: string; text: string }) {
    await sendMetaText({
      accessToken: this.accessToken,
      recipientId: params.recipientId,
      text: params.text,
    });
  }
}

export function createInstagramSender(): InstagramSender {
  if (env.INSTAGRAM_PAGE_ACCESS_TOKEN) return new MetaInstagramSender(env.INSTAGRAM_PAGE_ACCESS_TOKEN);
  return new LogInstagramSender();
}

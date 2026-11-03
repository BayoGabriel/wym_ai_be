import { env } from '../../../config/env';
import { sendMetaText } from '../meta/common';

// Outbound delivery abstraction for the Messenger channel. The Meta sender is
// used when MESSENGER_PAGE_ACCESS_TOKEN is configured; otherwise deliveries
// are logged so the pipeline is exercisable without credentials.
export interface MessengerSender {
  name: string;
  send(params: { recipientId: string; text: string }): Promise<void>;
}

export class LogMessengerSender implements MessengerSender {
  readonly name = 'LOG';

  async send(params: { recipientId: string; text: string }) {
    // eslint-disable-next-line no-console
    console.log(`[messenger] -> ${params.recipientId}: ${params.text}`);
  }
}

export class MetaMessengerSender implements MessengerSender {
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

export function createMessengerSender(): MessengerSender {
  if (env.MESSENGER_PAGE_ACCESS_TOKEN) return new MetaMessengerSender(env.MESSENGER_PAGE_ACCESS_TOKEN);
  return new LogMessengerSender();
}

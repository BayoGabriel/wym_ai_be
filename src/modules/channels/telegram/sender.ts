import { env } from '../../../config/env';

// Telegram replies go through the Bot API using the org's own bot token —
// the same credential embedded in the inbound webhook path.
export async function sendTelegramText(params: {
  botToken: string;
  chatId: number | string;
  text: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.NOTIFICATION_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${env.TELEGRAM_API_BASE}/bot${params.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text.slice(0, 4096),
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      throw new Error(`Telegram send failed (${res.status})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

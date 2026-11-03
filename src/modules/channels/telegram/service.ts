import { eq } from 'drizzle-orm';
import { db } from '../../../database/client';
import { organizationSettings } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { handleInboundChannelText } from '../shared/inbound';
import { sendTelegramText } from './sender';

// Maps an inbound Telegram message to an org conversation via the bot token
// embedded in the webhook path, runs the shared AI pipeline, and replies via
// the Bot API. Idempotent on (chatId, message_id), which Telegram guarantees
// unique per chat.
export async function handleInboundTelegramText(params: {
  botToken: string;
  chatId: number;
  text: string;
  messageId: number;
  displayName?: string;
}) {
  const [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.telegramBotToken, params.botToken))
    .limit(1);
  if (!settings) {
    throw new ApiError(404, 'NOT_FOUND', 'No organization bound to this Telegram bot');
  }

  const result = await handleInboundChannelText({
    channel: 'TELEGRAM',
    organizationId: settings.organizationId,
    externalSessionId: `tg:${params.chatId}`,
    title: params.displayName
      ? `Telegram: ${params.displayName}`
      : `Telegram: ${params.chatId}`,
    text: params.text,
    clientRequestId: `tg:${params.chatId}:${params.messageId}`,
    metadata: { chatId: params.chatId },
  });

  // Delivery failures must not fail the webhook — inbound state is already
  // committed and provider retries only re-process safely.
  let replied = false;
  if (result.reply) {
    try {
      await sendTelegramText({
        botToken: params.botToken,
        chatId: params.chatId,
        text: result.reply,
      });
      replied = true;
    } catch (err) {
       
      console.error('[telegram] reply delivery failed:', err);
    }
  }

  return { conversationId: result.conversationId, replied };
}

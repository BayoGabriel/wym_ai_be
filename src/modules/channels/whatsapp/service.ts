import { eq } from 'drizzle-orm';
import { db } from '../../../database/client';
import { organizationSettings } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { handleInboundChannelText } from '../shared/inbound';
import { createWhatsAppSender } from './sender';

const sender = createWhatsAppSender();

// Maps an inbound WhatsApp text message to an org conversation, runs the same
// grounded AI pipeline as the website widget, and replies via the sender.
// Idempotent on the provider message id so Meta retries are safe.
export async function handleInboundWhatsAppText(params: {
  phoneNumberId: string;
  from: string;
  text: string;
  messageId: string;
  displayName?: string;
}) {
  const [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.whatsappPhoneNumberId, params.phoneNumberId))
    .limit(1);
  if (!settings) {
    throw new ApiError(404, 'NOT_FOUND', 'No organization bound to this WhatsApp number');
  }

  const result = await handleInboundChannelText({
    channel: 'WHATSAPP',
    organizationId: settings.organizationId,
    externalSessionId: `wa:${params.from}`,
    title: params.displayName ? `WhatsApp: ${params.displayName}` : `WhatsApp: ${params.from}`,
    text: params.text,
    clientRequestId: `wa:${params.messageId}`,
    metadata: { from: params.from },
  });

  // Delivery failures must not fail the webhook — inbound state is already
  // committed and provider retries only re-process safely.
  let replied = false;
  if (result.reply) {
    try {
      await sender.send({
        phoneNumberId: params.phoneNumberId,
        to: params.from,
        text: result.reply,
      });
      replied = true;
    } catch (err) {
       
      console.error('[whatsapp] reply delivery failed:', err);
    }
  }

  return { conversationId: result.conversationId, replied };
}

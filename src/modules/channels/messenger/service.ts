import { eq } from 'drizzle-orm';
import { db } from '../../../database/client';
import { organizationSettings } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { handleInboundChannelText } from '../shared/inbound';
import { createMessengerSender } from './sender';

const sender = createMessengerSender();

// Maps an inbound Messenger text message to an org conversation via the page
// id bound in organization settings, runs the shared AI pipeline, and replies
// through the Send API. Idempotent on the Meta message id.
export async function handleInboundMessengerText(params: {
  pageId: string;
  senderPsid: string;
  text: string;
  messageId: string;
}) {
  const [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.messengerPageId, params.pageId))
    .limit(1);
  if (!settings) {
    throw new ApiError(404, 'NOT_FOUND', 'No organization bound to this Messenger page');
  }

  const result = await handleInboundChannelText({
    channel: 'MESSENGER',
    organizationId: settings.organizationId,
    externalSessionId: `fb:${params.senderPsid}`,
    title: `Messenger: ${params.senderPsid}`,
    text: params.text,
    clientRequestId: `fb:${params.messageId}`,
    metadata: { pageId: params.pageId, senderPsid: params.senderPsid },
  });

  // Delivery failures must not fail the webhook — inbound state is already
  // committed and provider retries only re-process safely.
  let replied = false;
  if (result.reply) {
    try {
      await sender.send({ recipientId: params.senderPsid, text: result.reply });
      replied = true;
    } catch (err) {
       
      console.error('[messenger] reply delivery failed:', err);
    }
  }

  return { conversationId: result.conversationId, replied };
}

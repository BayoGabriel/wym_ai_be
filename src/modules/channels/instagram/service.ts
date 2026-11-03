import { eq } from 'drizzle-orm';
import { db } from '../../../database/client';
import { organizationSettings } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { handleInboundChannelText } from '../shared/inbound';
import { createInstagramSender } from './sender';

const sender = createInstagramSender();

// Maps an inbound Instagram DM to an org conversation via the IG professional
// account id bound in organization settings, runs the shared AI pipeline, and
// replies through the Send API. Idempotent on the Meta message id.
export async function handleInboundInstagramText(params: {
  accountId: string;
  senderIgsid: string;
  text: string;
  messageId: string;
}) {
  const [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.instagramAccountId, params.accountId))
    .limit(1);
  if (!settings) {
    throw new ApiError(404, 'NOT_FOUND', 'No organization bound to this Instagram account');
  }

  const result = await handleInboundChannelText({
    channel: 'INSTAGRAM',
    organizationId: settings.organizationId,
    externalSessionId: `ig:${params.senderIgsid}`,
    title: `Instagram: ${params.senderIgsid}`,
    text: params.text,
    clientRequestId: `ig:${params.messageId}`,
    metadata: { accountId: params.accountId, senderIgsid: params.senderIgsid },
  });

  // Delivery failures must not fail the webhook — inbound state is already
  // committed and provider retries only re-process safely.
  let replied = false;
  if (result.reply) {
    try {
      await sender.send({ recipientId: params.senderIgsid, text: result.reply });
      replied = true;
    } catch (err) {
       
      console.error('[instagram] reply delivery failed:', err);
    }
  }

  return { conversationId: result.conversationId, replied };
}

import { and, eq } from 'drizzle-orm';
import { db } from '../../../database/client';
import { conversations, organizations } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { organizationHasProduct } from '../../products/service';
import { createUserMessageAndGenerateAssistant } from '../../conversations/service';

export type InboundChannel = 'WHATSAPP' | 'MESSENGER' | 'INSTAGRAM' | 'TELEGRAM' | 'EMAIL';

// Shared inbound pipeline for external chat channels: verifies the org's
// WYMASSIST entitlement, finds-or-creates the external conversation, runs the
// same grounded AI pipeline as the website widget, and returns the reply for
// the channel-specific sender to deliver. Idempotent on clientRequestId so
// provider retries are safe.
export async function handleInboundChannelText(params: {
  channel: InboundChannel;
  organizationId: string;
  externalSessionId: string;
  title: string;
  text: string;
  clientRequestId?: string;
  metadata?: Record<string, unknown>;
}) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, params.organizationId))
    .limit(1);
  if (!org || org.status !== 'active' || !(await organizationHasProduct(org.id, 'WYMASSIST'))) {
    throw new ApiError(403, 'CHANNEL_UNAVAILABLE', 'Assistant is not available on this channel');
  }

  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, org.id),
        eq(conversations.externalSessionId, params.externalSessionId)
      )
    )
    .limit(1);

  if (!conversation) {
    [conversation] = await db
      .insert(conversations)
      .values({
        organizationId: org.id,
        status: 'ACTIVE',
        channel: params.channel,
        externalSessionId: params.externalSessionId,
        title: params.title,
      })
      .returning();
  } else if (conversation.status !== 'ACTIVE') {
    // externalSessionId is unique per org — a new inbound on a closed/archived
    // conversation reopens it rather than inserting a duplicate row.
    [conversation] = await db
      .update(conversations)
      .set({ status: 'ACTIVE', updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id))
      .returning();
  }

  const result = await createUserMessageAndGenerateAssistant({
    organizationId: org.id,
    conversationId: conversation.id,
    content: params.text,
    clientRequestId: params.clientRequestId,
    metadata: { channel: params.channel, ...params.metadata },
  });

  return { conversationId: conversation.id, reply: result.assistantMessage?.content ?? null };
}

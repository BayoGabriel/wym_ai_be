import { eq, sql } from 'drizzle-orm';
import { db } from '../../../database/client';
import { organizationSettings } from '../../../database/schema/core';
import { ApiError } from '../../../middleware/error';
import { env } from '../../../config/env';
import { handleInboundChannelText } from '../shared/inbound';
import { createEmailSender } from './sender';

const sender = createEmailSender();

// Accepts both bare addresses and "Display Name <addr@host>" forms.
export function parseEmailAddress(raw: string): string | null {
  const match = raw.match(/<([^>]+)>/);
  const addr = (match ? match[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

// Maps an inbound email to an org conversation via the inbound address bound
// in organization settings, runs the shared AI pipeline, and sends the reply
// through the configured sender. Idempotent on the provider Message-Id.
export async function handleInboundEmail(params: {
  from: string;
  to: string;
  subject?: string;
  text: string;
  messageId?: string;
}) {
  const from = parseEmailAddress(params.from);
  const to = parseEmailAddress(params.to);
  if (!from || !to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid from/to address');
  }

  const [settings] = await db
    .select()
    .from(organizationSettings)
    .where(eq(sql`lower(${organizationSettings.inboundEmailAddress})`, to))
    .limit(1);
  if (!settings) {
    throw new ApiError(404, 'NOT_FOUND', 'No organization bound to this inbound address');
  }

  const result = await handleInboundChannelText({
    channel: 'EMAIL',
    organizationId: settings.organizationId,
    externalSessionId: `email:${from}`,
    title: `Email: ${from}`,
    text: params.text,
    clientRequestId: params.messageId ? `email:${params.messageId}` : undefined,
    metadata: { from, to, subject: params.subject, messageId: params.messageId },
  });

  // Delivery failures must not fail the webhook — inbound state is already
  // committed and provider retries only re-process safely.
  let replied = false;
  if (result.reply) {
    const subject = params.subject
      ? /^re:/i.test(params.subject)
        ? params.subject
        : `Re: ${params.subject}`
      : 'Your enquiry';
    try {
      await sender.send({
        from: settings.inboundEmailAddress ?? env.EMAIL_FROM ?? 'assist@wymnet.ai',
        to: from,
        subject,
        text: result.reply,
        inReplyTo: params.messageId,
      });
      replied = true;
    } catch (err) {
       
      console.error('[email] reply delivery failed:', err);
    }
  }

  return { conversationId: result.conversationId, replied };
}

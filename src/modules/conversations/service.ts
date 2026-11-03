import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  chatSessions,
  conversations,
  handoffs,
  messages,
  products,
  usageRecords,
} from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { generateResponse } from '../ai/service';
import { recordAudit } from '../audit/service';
import { env } from '../../config/env';

type ConversationStatus = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
type ConversationChannel = 'WEB' | 'API';
type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

type MessageRow = typeof messages.$inferSelect;

function stringifyMetadata(value?: Record<string, unknown>) {
  if (!value) return null;
  return JSON.stringify(value);
}

function parseMetadata(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function assertWritableConversation(status: ConversationStatus) {
  if (status === 'ACTIVE') return;
  throw new ApiError(
    409,
    'CONVERSATION_READ_ONLY',
    'Conversation is not active and cannot accept new messages'
  );
}

function isValidStatusTransition(from: ConversationStatus, to: ConversationStatus) {
  if (from === to) return true;
  if (from === 'ACTIVE' && (to === 'CLOSED' || to === 'ARCHIVED')) return true;
  if (from === 'CLOSED' && to === 'ARCHIVED') return true;
  return false;
}

function mapConversation(row: typeof conversations.$inferSelect) {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}

function mapMessage(row: MessageRow) {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}

export async function createConversation(params: {
  organizationId: string;
  userId?: string | null;
  channel: ConversationChannel;
  externalSessionId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}) {
  const [created] = await db
    .insert(conversations)
    .values({
      organizationId: params.organizationId,
      status: 'ACTIVE',
      channel: params.channel,
      externalSessionId: params.externalSessionId ?? null,
      title: params.title ?? null,
      metadata: stringifyMetadata(params.metadata),
    })
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'conversation.created',
    resourceType: 'conversation',
    resourceId: created.id,
    metadata: { channel: created.channel },
  });

  return mapConversation(created);
}

export async function listConversations(params: {
  organizationId: string;
  page: number;
  limit: number;
  status?: ConversationStatus;
  order: 'asc' | 'desc';
}) {
  const where = params.status
    ? and(
        eq(conversations.organizationId, params.organizationId),
        eq(conversations.status, params.status)
      )
    : eq(conversations.organizationId, params.organizationId);

  const rows = await db
    .select()
    .from(conversations)
    .where(where)
    .orderBy(params.order === 'asc' ? asc(conversations.createdAt) : desc(conversations.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totalRow] = await db.select({ value: count() }).from(conversations).where(where);

  return {
    items: rows.map(mapConversation),
    page: params.page,
    limit: params.limit,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getConversationOrThrow(organizationId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId))
    )
    .limit(1);

  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
  }
  return conversation;
}

export async function getConversationById(organizationId: string, conversationId: string) {
  const row = await getConversationOrThrow(organizationId, conversationId);
  return mapConversation(row);
}

export async function updateConversation(params: {
  organizationId: string;
  userId: string;
  conversationId: string;
  title?: string;
  status?: ConversationStatus;
  metadata?: Record<string, unknown>;
}) {
  const existing = await getConversationOrThrow(params.organizationId, params.conversationId);

  if (
    params.status &&
    !isValidStatusTransition(
      existing.status as ConversationStatus,
      params.status as ConversationStatus
    )
  ) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition conversation from ${existing.status} to ${params.status}`
    );
  }

  const updates: Partial<typeof conversations.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof params.title === 'string') updates.title = params.title;
  if (params.status) {
    updates.status = params.status;
    updates.closedAt = params.status === 'CLOSED' ? new Date() : null;
  }
  if (params.metadata) updates.metadata = stringifyMetadata(params.metadata);

  const [updated] = await db
    .update(conversations)
    .set(updates)
    .where(eq(conversations.id, params.conversationId))
    .returning();

  if (params.status === 'ARCHIVED') {
    await revokeSessionsForConversation(params.conversationId);
  }

  const action =
    params.status === 'ARCHIVED'
      ? 'conversation.archived'
      : params.status === 'CLOSED'
        ? 'conversation.closed'
        : 'conversation.updated';

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action,
    resourceType: 'conversation',
    resourceId: updated.id,
    metadata: {
      fields: Object.keys(updates),
      status: updated.status,
    },
  });

  return mapConversation(updated);
}

export async function revokeSessionsForConversation(conversationId: string) {
  await db
    .update(chatSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(chatSessions.conversationId, conversationId), isNull(chatSessions.revokedAt)));
}

export async function listConversationMessages(params: {
  organizationId: string;
  conversationId: string;
  page: number;
  limit: number;
}) {
  await getConversationOrThrow(params.organizationId, params.conversationId);
  const where = and(
    eq(messages.conversationId, params.conversationId),
    eq(messages.organizationId, params.organizationId)
  );

  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(asc(messages.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totalRow] = await db.select({ value: count() }).from(messages).where(where);

  return {
    items: rows.map(mapMessage),
    page: params.page,
    limit: params.limit,
    total: Number(totalRow?.value ?? 0),
  };
}

type DbOrTx = typeof db;

async function findMessageByClientRequestId(
  q: DbOrTx,
  params: {
    organizationId: string;
    conversationId: string;
    clientRequestId: string;
  }
) {
  const [row] = await q
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, params.organizationId),
        eq(messages.conversationId, params.conversationId),
        eq(messages.clientRequestId, params.clientRequestId),
        eq(messages.role, 'USER')
      )
    )
    .limit(1);
  return row;
}

async function findAssistantForUserMessage(
  q: DbOrTx,
  params: {
    conversationId: string;
    userMessageId: string;
  }
) {
  const [row] = await q
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, params.conversationId),
        eq(messages.clientRequestId, `assistant:${params.userMessageId}`),
        eq(messages.role, 'ASSISTANT')
      )
    )
    .limit(1);
  return row;
}

async function createAssistantMessage(
  q: DbOrTx,
  params: {
    organizationId: string;
    conversationId: string;
    userMessageId: string;
    content: string;
    sources: Array<{ chunkId: string; knowledgeItemId: string; score: number }>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    meta?: Record<string, unknown>;
    grounded: boolean;
  }
) {
  const assistantRequestId = `assistant:${params.userMessageId}`;
  const metadata = {
    respondingToMessageId: params.userMessageId,
    sources: params.sources,
    usage: params.usage,
    meta: params.meta,
    grounded: params.grounded,
  };

  const inserted = q.insert(messages).values({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    role: 'ASSISTANT',
    content: params.content,
    clientRequestId: assistantRequestId,
    metadata: JSON.stringify(metadata),
  });

  const rows = await inserted
    .onConflictDoNothing({
      target: [messages.conversationId, messages.clientRequestId],
    })
    .returning();

  const [assistant] = rows;
  if (assistant) return { row: assistant, created: true };

  const [existing] = await q
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, params.organizationId),
        eq(messages.conversationId, params.conversationId),
        eq(messages.clientRequestId, assistantRequestId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Assistant message persistence failed');
  }
  return { row: existing, created: false };
}

async function recordConversationUsage(params: {
  organizationId: string;
  usage?: { totalTokens?: number };
  model?: string;
}) {
  const [assistProduct] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.code, 'WYMASSIST'))
    .limit(1);

  await db.insert(usageRecords).values({
    organizationId: params.organizationId,
    productId: assistProduct?.id ?? null,
    eventType: 'conversation.ai.response',
    quantity: Math.max(params.usage?.totalTokens ?? 1, 1),
    provider: params.model ?? null,
  });
}

export async function createUserMessageAndGenerateAssistant(params: {
  organizationId: string;
  userId?: string | null;
  conversationId: string;
  content: string;
  clientRequestId?: string;
  metadata?: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, params.conversationId),
          eq(conversations.organizationId, params.organizationId)
        )
      )
      .for('update')
      .limit(1);

    if (!conversation) {
      throw new ApiError(404, 'NOT_FOUND', 'Conversation not found');
    }
    assertWritableConversation(conversation.status as ConversationStatus);

    let userMessage: MessageRow | undefined;
    if (params.clientRequestId) {
      userMessage = await findMessageByClientRequestId(tx as DbOrTx, {
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        clientRequestId: params.clientRequestId,
      });
    }

    if (!userMessage) {
      const values: typeof messages.$inferInsert = {
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        role: 'USER' as MessageRole,
        content: params.content,
        clientRequestId: params.clientRequestId ?? null,
        metadata: stringifyMetadata(params.metadata),
      };
      try {
        [userMessage] = await tx.insert(messages).values(values).returning();
      } catch (error) {
        if (!params.clientRequestId) throw error;
        userMessage = await findMessageByClientRequestId(tx as DbOrTx, {
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          clientRequestId: params.clientRequestId,
        });
        if (!userMessage) throw error;
      }
    }

    const existingAssistant = await findAssistantForUserMessage(tx as DbOrTx, {
      conversationId: params.conversationId,
      userMessageId: userMessage.id,
    });

    if (existingAssistant) {
      const assistantMetadata = parseMetadata(existingAssistant.metadata);
      return {
        conversation: mapConversation(conversation),
        userMessage: mapMessage(userMessage),
        assistantMessage: mapMessage(existingAssistant),
        ai: {
          grounded: !!assistantMetadata?.grounded,
          sources: assistantMetadata?.sources ?? [],
          usage: assistantMetadata?.usage,
          meta: assistantMetadata?.meta,
        },
        idempotentReplay: true,
      };
    }

    // Active human handoff: pause AI generation and acknowledge receipt
    // instead. The conversation row lock (taken above) serializes this check
    // with handoff requests, so a handoff created before this message always
    // wins — the AI cannot bypass a paused conversation.
    const [activeHandoff] = await tx
      .select({ id: handoffs.id })
      .from(handoffs)
      .where(
        and(
          eq(handoffs.conversationId, params.conversationId),
          eq(handoffs.organizationId, params.organizationId),
          inArray(handoffs.status, ['REQUESTED', 'QUEUED', 'ASSIGNED'])
        )
      )
      .limit(1);

    if (activeHandoff) {
      const assistant = await createAssistantMessage(tx as DbOrTx, {
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        userMessageId: userMessage.id,
        content: env.PUBLIC_CHAT_HANDOFF_ACK_MESSAGE,
        sources: [],
        meta: { handoffPaused: true, handoffId: activeHandoff.id },
        grounded: false,
      });
      return {
        conversation: mapConversation(conversation),
        userMessage: mapMessage(userMessage),
        assistantMessage: mapMessage(assistant.row),
        ai: {
          grounded: false,
          sources: [],
          usage: undefined,
          meta: { handoffPaused: true, handoffId: activeHandoff.id },
        },
        idempotentReplay: !assistant.created,
      };
    }

    const recentRows = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, params.organizationId),
          eq(messages.conversationId, params.conversationId)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(24);

    const history = recentRows
      .slice()
      .reverse()
      .map((m) => ({
        role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }));

    let ai:
      | Awaited<ReturnType<typeof generateResponse>>
      | {
          message: string;
          grounded: false;
          sources: [];
          usage: undefined;
          meta: { error: string };
        };
    try {
      ai = await generateResponse({
        organizationId: params.organizationId,
        userId: params.userId,
        message: params.content,
        conversationContext: { messages: history },
      });
    } catch {
      ai = {
        message: env.AI_FALLBACK_MESSAGE,
        grounded: false,
        sources: [],
        usage: undefined,
        meta: { error: 'AI_FAILURE' },
      };
      await recordAudit({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        action: 'conversation.ai.failed',
        resourceType: 'conversation',
        resourceId: params.conversationId,
        metadata: { userMessageId: userMessage.id },
      });
    }

    const assistant = await createAssistantMessage(tx as DbOrTx, {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      userMessageId: userMessage.id,
      content: ai.message,
      sources: ai.sources,
      usage: ai.usage,
      meta: ai.meta,
      grounded: ai.grounded,
    });

    if (assistant.created) {
      await recordConversationUsage({
        organizationId: params.organizationId,
        usage: ai.usage,
        model: String((ai.meta as Record<string, unknown>)?.model ?? ''),
      });
    }

    return {
      conversation: mapConversation(conversation),
      userMessage: mapMessage(userMessage),
      assistantMessage: mapMessage(assistant.row),
      ai: {
        grounded: ai.grounded,
        sources: ai.sources,
        usage: ai.usage,
        meta: ai.meta,
      },
      idempotentReplay: false,
    };
  });
}

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  chatSessions,
  conversations,
  handoffNotes,
  handoffs,
  messages,
  users,
} from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import type { HandoffStatus } from './schemas';

type HandoffRow = typeof handoffs.$inferSelect;
type HandoffNoteRow = typeof handoffNotes.$inferSelect;
type DbOrTx = typeof db;

// Non-terminal states. A conversation may hold at most one of these
// (enforced by the handoffs_active_conv_unique partial unique index).
export const ACTIVE_HANDOFF_STATUSES: HandoffStatus[] = ['REQUESTED', 'QUEUED', 'ASSIGNED'];

const TRANSITIONS: Record<HandoffStatus, HandoffStatus[]> = {
  REQUESTED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['RESOLVED', 'QUEUED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
};

export function isValidHandoffTransition(from: HandoffStatus, to: HandoffStatus) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isActiveHandoff(status: string) {
  return (ACTIVE_HANDOFF_STATUSES as string[]).includes(status);
}

export function toPublicHandoff(row: HandoffRow, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    ...extra,
  };
}

function mapNote(row: HandoffNoteRow) {
  return {
    id: row.id,
    body: row.body,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
  };
}

export async function findActiveHandoffForConversation(
  q: DbOrTx,
  conversationId: string
): Promise<HandoffRow | undefined> {
  const [row] = await q
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.conversationId, conversationId),
        inArray(handoffs.status, ACTIVE_HANDOFF_STATUSES)
      )
    )
    .limit(1);
  return row;
}

/**
 * Public visitor entry point. Organization, conversation and session are all
 * server-derived from the authenticated public session — never from the body.
 * The conversation row is locked FOR UPDATE so this serializes with an
 * in-progress AI generation on the same conversation.
 */
export async function requestHandoffFromPublicSession(params: {
  organizationId: string;
  conversationId: string;
  sessionId: string;
  reason?: string;
}) {
  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, params.organizationId))
    .limit(1);
  if (!config?.escalationEnabled) {
    throw new ApiError(403, 'ESCALATION_DISABLED', 'Human handoff is not enabled');
  }

  const { handoff, existing } = await db.transaction(async (tx) => {
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
      throw new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid');
    }
    if (conversation.status !== 'ACTIVE') {
      throw new ApiError(
        409,
        'CONVERSATION_READ_ONLY',
        'Conversation is not active and cannot accept a handoff request'
      );
    }

    const active = await findActiveHandoffForConversation(tx, params.conversationId);
    if (active) return { handoff: active, existing: true };

    try {
      const [created] = await tx
        .insert(handoffs)
        .values({
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          chatSessionId: params.sessionId,
          status: 'QUEUED',
          requestedBy: 'VISITOR',
          reason: params.reason ?? null,
        })
        .returning();
      return { handoff: created, existing: false };
    } catch (error) {
      // Concurrent request raced past the partial unique index — return the
      // winner's handoff so repeated requests stay idempotent.
      const winner = await findActiveHandoffForConversation(tx, params.conversationId);
      if (!winner) throw error;
      return { handoff: winner, existing: true };
    }
  });

  if (!existing) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: null,
      action: 'handoff.requested',
      resourceType: 'handoff',
      resourceId: handoff.id,
      metadata: { requestedBy: 'VISITOR', hasReason: !!params.reason },
    });
  }

  return { handoff, existing };
}

export async function getPublicHandoffStatus(params: {
  organizationId: string;
  conversationId: string;
  sessionId: string;
}) {
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, params.sessionId),
        eq(chatSessions.organizationId, params.organizationId),
        eq(chatSessions.conversationId, params.conversationId)
      )
    )
    .limit(1);
  if (!session) throw new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid');

  const [latest] = await db
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.conversationId, params.conversationId),
        eq(handoffs.organizationId, params.organizationId)
      )
    )
    .orderBy(desc(handoffs.createdAt))
    .limit(1);

  return latest ?? null;
}

export async function listHandoffs(params: {
  organizationId: string;
  page: number;
  limit: number;
  status?: HandoffStatus;
  assignedTo?: string;
  order: 'asc' | 'desc';
}) {
  const conditions = [eq(handoffs.organizationId, params.organizationId)];
  if (params.status) conditions.push(eq(handoffs.status, params.status));
  if (params.assignedTo) conditions.push(eq(handoffs.assignedTo, params.assignedTo));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(handoffs)
    .where(where)
    .orderBy(params.order === 'asc' ? asc(handoffs.createdAt) : desc(handoffs.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totalRow] = await db.select({ value: count() }).from(handoffs).where(where);

  return {
    items: rows,
    page: params.page,
    limit: params.limit,
    total: Number(totalRow?.value ?? 0),
  };
}

async function getHandoffOrThrow(organizationId: string, handoffId: string) {
  const [handoff] = await db
    .select()
    .from(handoffs)
    .where(and(eq(handoffs.id, handoffId), eq(handoffs.organizationId, organizationId)))
    .limit(1);
  if (!handoff) throw new ApiError(404, 'NOT_FOUND', 'Handoff not found');
  return handoff;
}

export async function getHandoffById(organizationId: string, handoffId: string) {
  const handoff = await getHandoffOrThrow(organizationId, handoffId);

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, handoff.conversationId),
        eq(conversations.organizationId, organizationId)
      )
    )
    .limit(1);

  const recentMessages = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, handoff.conversationId),
        eq(messages.organizationId, organizationId)
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(10);

  const notes = await db
    .select()
    .from(handoffNotes)
    .where(
      and(eq(handoffNotes.handoffId, handoff.id), eq(handoffNotes.organizationId, organizationId))
    )
    .orderBy(asc(handoffNotes.createdAt));

  return {
    ...handoff,
    conversation: conversation
      ? { id: conversation.id, status: conversation.status, title: conversation.title }
      : null,
    recentMessages: recentMessages.reverse(),
    notes: notes.map(mapNote),
  };
}

async function assertActiveAssignee(organizationId: string, userId: string) {
  const [assignee] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.status, 'active')
      )
    )
    .limit(1);
  if (!assignee) {
    throw new ApiError(
      400,
      'INVALID_ASSIGNEE',
      'Assignee must be an active user in this organization'
    );
  }
}

/** Atomic claim: only one concurrent claimant can win the status transition. */
export async function claimHandoff(params: {
  organizationId: string;
  userId: string;
  handoffId: string;
}) {
  const [claimed] = await db
    .update(handoffs)
    .set({
      status: 'ASSIGNED',
      assignedTo: params.userId,
      assignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(handoffs.id, params.handoffId),
        eq(handoffs.organizationId, params.organizationId),
        inArray(handoffs.status, ['REQUESTED', 'QUEUED'])
      )
    )
    .returning();

  if (claimed) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: 'handoff.claimed',
      resourceType: 'handoff',
      resourceId: claimed.id,
      metadata: { assignedTo: params.userId },
    });
    return claimed;
  }

  const existing = await getHandoffOrThrow(params.organizationId, params.handoffId);
  if (existing.status === 'ASSIGNED') {
    throw new ApiError(409, 'HANDOFF_ALREADY_CLAIMED', 'Handoff has already been claimed');
  }
  throw new ApiError(
    400,
    'INVALID_STATUS_TRANSITION',
    `Cannot claim a handoff in status ${existing.status}`
  );
}

/**
 * Assign, reassign, or release (userId null → back to QUEUED).
 * Requires the handoff.assign permission — enforced at the route layer.
 */
export async function assignHandoff(params: {
  organizationId: string;
  actorUserId: string;
  handoffId: string;
  userId: string | null;
}) {
  const existing = await getHandoffOrThrow(params.organizationId, params.handoffId);
  const current = existing.status as HandoffStatus;

  if (params.userId === null) {
    if (!isValidHandoffTransition(current, 'QUEUED')) {
      throw new ApiError(
        400,
        'INVALID_STATUS_TRANSITION',
        `Cannot release a handoff in status ${current}`
      );
    }
    const [updated] = await db
      .update(handoffs)
      .set({ status: 'QUEUED', assignedTo: null, assignedAt: null, updatedAt: new Date() })
      .where(and(eq(handoffs.id, existing.id), eq(handoffs.organizationId, params.organizationId)))
      .returning();
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: 'handoff.released',
      resourceType: 'handoff',
      resourceId: updated.id,
      metadata: { from: existing.assignedTo },
    });
    return updated;
  }

  await assertActiveAssignee(params.organizationId, params.userId);

  const target: HandoffStatus = 'ASSIGNED';
  if (!isValidHandoffTransition(current, target)) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot assign a handoff in status ${current}`
    );
  }

  const [updated] = await db
    .update(handoffs)
    .set({
      status: 'ASSIGNED',
      assignedTo: params.userId,
      assignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(handoffs.id, existing.id), eq(handoffs.organizationId, params.organizationId)))
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: 'handoff.assigned',
    resourceType: 'handoff',
    resourceId: updated.id,
    metadata: { from: existing.assignedTo, to: params.userId },
  });
  return updated;
}

function assertCanOperateOnAssignment(handoff: HandoffRow, userId: string, canAssign: boolean) {
  if (handoff.assignedTo === userId) return;
  if (canAssign) return;
  throw new ApiError(
    403,
    'FORBIDDEN',
    'Only the assignee or a handoff.assign holder can perform this action'
  );
}

export async function resolveHandoff(params: {
  organizationId: string;
  userId: string;
  canAssign: boolean;
  handoffId: string;
  resolutionSummary?: string;
}) {
  const existing = await getHandoffOrThrow(params.organizationId, params.handoffId);
  const current = existing.status as HandoffStatus;
  if (!isValidHandoffTransition(current, 'RESOLVED')) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot resolve a handoff in status ${current}`
    );
  }
  assertCanOperateOnAssignment(existing, params.userId, params.canAssign);

  const [updated] = await db
    .update(handoffs)
    .set({
      status: 'RESOLVED',
      resolvedBy: params.userId,
      resolvedAt: new Date(),
      resolutionSummary: params.resolutionSummary ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(handoffs.id, existing.id), eq(handoffs.organizationId, params.organizationId)))
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'handoff.resolved',
    resourceType: 'handoff',
    resourceId: updated.id,
    metadata: { hasSummary: !!params.resolutionSummary },
  });
  return updated;
}

export async function cancelHandoff(params: {
  organizationId: string;
  userId: string;
  canAssign: boolean;
  handoffId: string;
  reason?: string;
}) {
  const existing = await getHandoffOrThrow(params.organizationId, params.handoffId);
  const current = existing.status as HandoffStatus;
  if (!isValidHandoffTransition(current, 'CANCELLED')) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot cancel a handoff in status ${current}`
    );
  }
  // QUEUED handoffs are unowned — any writer may cancel; ASSIGNED handoffs
  // require the assignee or a handoff.assign holder.
  if (current === 'ASSIGNED') {
    assertCanOperateOnAssignment(existing, params.userId, params.canAssign);
  }

  const [updated] = await db
    .update(handoffs)
    .set({
      status: 'CANCELLED',
      cancelledBy: params.userId,
      cancelledAt: new Date(),
      cancellationReason: params.reason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(handoffs.id, existing.id), eq(handoffs.organizationId, params.organizationId)))
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'handoff.cancelled',
    resourceType: 'handoff',
    resourceId: updated.id,
    metadata: { hasReason: !!params.reason },
  });
  return updated;
}

export async function addHandoffNote(params: {
  organizationId: string;
  userId: string;
  handoffId: string;
  body: string;
}) {
  const handoff = await getHandoffOrThrow(params.organizationId, params.handoffId);
  const [note] = await db
    .insert(handoffNotes)
    .values({
      handoffId: handoff.id,
      organizationId: params.organizationId,
      authorUserId: params.userId,
      body: params.body,
    })
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'handoff.note_added',
    resourceType: 'handoff',
    resourceId: handoff.id,
    metadata: { noteId: note.id },
  });
  return mapNote(note);
}

/**
 * Staff reply to the visitor. Only the assignee may reply, only while the
 * handoff is ASSIGNED and the underlying conversation is still writable.
 * Replies are AGENT-role messages — visible in public history, unlike
 * handoff_notes which are internal only. Idempotent via clientRequestId.
 */
export async function replyToHandoff(params: {
  organizationId: string;
  userId: string;
  handoffId: string;
  content: string;
  clientRequestId?: string;
}) {
  const handoff = await getHandoffOrThrow(params.organizationId, params.handoffId);
  if (handoff.status !== 'ASSIGNED') {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot reply to a handoff in status ${handoff.status}`
    );
  }
  if (handoff.assignedTo !== params.userId) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the assigned agent can reply to this handoff');
  }

  const [conversation] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, handoff.conversationId),
        eq(conversations.organizationId, params.organizationId)
      )
    )
    .limit(1);
  if (!conversation || conversation.status !== 'ACTIVE') {
    throw new ApiError(
      409,
      'CONVERSATION_READ_ONLY',
      'Conversation is not active and cannot accept new messages'
    );
  }

  const clientRequestId = params.clientRequestId ? `staff:${params.clientRequestId}` : null;
  const metadata = JSON.stringify({ authorUserId: params.userId, handoffId: handoff.id });

  const inserted = await db
    .insert(messages)
    .values({
      organizationId: params.organizationId,
      conversationId: handoff.conversationId,
      role: 'AGENT',
      content: params.content,
      clientRequestId,
      metadata,
    })
    .onConflictDoNothing({ target: [messages.conversationId, messages.clientRequestId] })
    .returning();

  let row = inserted[0];
  if (!row) {
    if (!clientRequestId) {
      throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Message persistence failed');
    }
    const [existing] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, handoff.conversationId),
          eq(messages.clientRequestId, clientRequestId),
          eq(messages.role, 'AGENT')
        )
      )
      .limit(1);
    if (!existing) {
      throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Message persistence failed');
    }
    row = existing;
  }

  if (inserted.length > 0) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: 'handoff.reply_sent',
      resourceType: 'handoff',
      resourceId: handoff.id,
      metadata: { messageId: row.id },
    });
  }

  return { message: row, idempotentReplay: inserted.length === 0 };
}

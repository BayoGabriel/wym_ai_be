import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  chatSessions,
  leadNotes,
  leads,
  users,
} from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import { notifyOrganization } from '../notifications/service';
import type { LeadStatus } from './schemas';

type LeadRow = typeof leads.$inferSelect;
type LeadNoteRow = typeof leadNotes.$inferSelect;

const TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['CONVERTED', 'LOST'],
  CONVERTED: [],
  LOST: [],
};

function isValidStatusTransition(from: LeadStatus, to: LeadStatus) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  return value.trim().replace(/[\s()-]/g, '');
}

export type IntakeField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'checkbox';
  required?: boolean;
  options?: string[];
};

export function parseIntakeFields(raw: unknown): IntakeField[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is IntakeField =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as IntakeField).key === 'string' &&
      typeof (f as IntakeField).label === 'string' &&
      ['text', 'select', 'checkbox'].includes((f as IntakeField).type)
  );
}

// Validates submitted answers against the org's configured intake fields.
// Returns only configured keys — unknown fields are dropped, not stored.
export function validateIntakeAnswers(
  fields: IntakeField[],
  answers: Record<string, unknown> | undefined
): Record<string, string | boolean> | null {
  if (!fields.length) return null;
  const result: Record<string, string | boolean> = {};
  const missing: string[] = [];
  for (const field of fields) {
    const value = answers?.[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required) missing.push(field.label);
      continue;
    }
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') {
        throw new ApiError(400, 'VALIDATION_ERROR', `Field "${field.label}" must be true or false`);
      }
      result[field.key] = value;
      continue;
    }
    if (typeof value !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Field "${field.label}" must be text`);
    }
    if (field.type === 'select' && field.options?.length && !field.options.includes(value)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `Field "${field.label}" must be one of the configured options`
      );
    }
    result[field.key] = value;
  }
  if (missing.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Missing required fields: ${missing.join(', ')}`);
  }
  return Object.keys(result).length ? result : null;
}

export function toPublicLead(row: LeadRow, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    ...extra,
  };
}

function mapLead(row: LeadRow) {
  return row;
}

export async function captureLeadFromPublicSession(params: {
  organizationId: string;
  conversationId: string;
  sessionId: string;
  name?: string;
  email?: string;
  phone?: string;
  enquiryCategory?: string;
  summary?: string;
  consentToContact?: boolean;
  customFields?: Record<string, unknown>;
  clientRequestId?: string;
}) {
  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, params.organizationId))
    .limit(1);
  if (!config?.leadCaptureEnabled) {
    throw new ApiError(403, 'LEAD_CAPTURE_DISABLED', 'Lead capture is not enabled');
  }

  const customFields = validateIntakeAnswers(
    parseIntakeFields(config.intakeFields),
    params.customFields
  );

  const email = params.email ? normalizeEmail(params.email) : undefined;
  const phone = params.phone ? normalizePhone(params.phone) : undefined;
  if (!params.name && !email && !phone) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'At least one of name, email or phone is required to submit an enquiry'
    );
  }

  // Serialize per-conversation lead captures so concurrent retries and duplicate
  // submissions resolve to a single row instead of racing the uniqueness check.
  const { lead, replay, deduplicated } = await db.transaction(async (tx) => {
    const [lockedSession] = await tx
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, params.sessionId),
          eq(chatSessions.organizationId, params.organizationId)
        )
      )
      .for('update')
      .limit(1);
    if (!lockedSession) {
      throw new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid');
    }

    if (params.clientRequestId) {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.conversationId, params.conversationId),
            eq(leads.clientRequestId, params.clientRequestId)
          )
        )
        .limit(1);
      if (existing) return { lead: existing, replay: true, deduplicated: false };
    }

    // Same-session duplicate guard: identical normalized contact details
    // return the existing lead instead of creating a second row.
    const sameSessionLeads = await tx
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.chatSessionId, params.sessionId),
          eq(leads.organizationId, params.organizationId)
        )
      );
    const duplicate = sameSessionLeads.find(
      (l) =>
        (l.name ?? null) === (params.name ?? null) &&
        (l.email ?? null) === (email ?? null) &&
        (l.phone ?? null) === (phone ?? null) &&
        (l.summary ?? null) === (params.summary ?? null)
    );
    if (duplicate) return { lead: duplicate, replay: false, deduplicated: true };

    const [created] = await tx
      .insert(leads)
      .values({
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        chatSessionId: params.sessionId,
        name: params.name ?? null,
        email: email ?? null,
        phone: phone ?? null,
        enquiryCategory: params.enquiryCategory ?? null,
        summary: params.summary ?? null,
        consentToContact: params.consentToContact ?? false,
        customFields: customFields ?? null,
        clientRequestId: params.clientRequestId ?? null,
        status: 'NEW',
        source: 'PUBLIC_CHAT',
      })
      .returning();
    return { lead: created, replay: false, deduplicated: false };
  });

  if (!replay && !deduplicated) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: null,
      action: 'lead.created',
      resourceType: 'lead',
      resourceId: lead.id,
      metadata: {
        source: 'PUBLIC_CHAT',
        hasEmail: !!email,
        hasPhone: !!phone,
        consentToContact: lead.consentToContact,
      },
    });
    await notifyOrganization({
      organizationId: params.organizationId,
      event: 'lead.created',
      subject: 'New enquiry captured via WymAssist',
      text: `A visitor shared their details${params.name ? ` (${params.name})` : ''} during a chat.`,
      link: '/dashboard/assist/leads',
    });
  }

  return {
    lead,
    idempotentReplay: replay,
    deduplicated,
  };
}

export async function listLeads(params: {
  organizationId: string;
  page: number;
  limit: number;
  status?: LeadStatus;
  source?: string;
  category?: string;
  assignedTo?: string;
  q?: string;
  order: 'asc' | 'desc';
}) {
  const conditions = [eq(leads.organizationId, params.organizationId)];
  if (params.status) conditions.push(eq(leads.status, params.status));
  if (params.source) conditions.push(eq(leads.source, params.source));
  if (params.category) conditions.push(eq(leads.enquiryCategory, params.category));
  if (params.assignedTo) conditions.push(eq(leads.assignedTo, params.assignedTo));
  if (params.q) {
    const like = `%${params.q}%`;
    conditions.push(
      or(
        ilike(leads.name, like),
        ilike(leads.email, like),
        ilike(leads.phone, like),
        ilike(leads.summary, like)
      )!
    );
  }
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(leads)
    .where(where)
    .orderBy(params.order === 'asc' ? asc(leads.createdAt) : desc(leads.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totalRow] = await db.select({ value: count() }).from(leads).where(where);

  return {
    items: rows.map(mapLead),
    page: params.page,
    limit: params.limit,
    total: Number(totalRow?.value ?? 0),
  };
}

async function getLeadOrThrow(organizationId: string, leadId: string) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found');
  return lead;
}

export async function getLeadById(organizationId: string, leadId: string) {
  const lead = await getLeadOrThrow(organizationId, leadId);
  const notes = await db
    .select()
    .from(leadNotes)
    .where(and(eq(leadNotes.leadId, lead.id), eq(leadNotes.organizationId, organizationId)))
    .orderBy(asc(leadNotes.createdAt));
  return { ...mapLead(lead), notes: notes.map(mapNote) };
}

function mapNote(row: LeadNoteRow) {
  return {
    id: row.id,
    body: row.body,
    authorUserId: row.authorUserId,
    createdAt: row.createdAt,
  };
}

export async function updateLead(params: {
  organizationId: string;
  userId: string;
  leadId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  enquiryCategory?: string | null;
  summary?: string | null;
  status?: LeadStatus;
  assignedTo?: string | null;
}) {
  const existing = await getLeadOrThrow(params.organizationId, params.leadId);

  if (params.status && !isValidStatusTransition(existing.status as LeadStatus, params.status)) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition lead from ${existing.status} to ${params.status}`
    );
  }

  if (params.assignedTo) {
    const [assignee] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, params.assignedTo),
          eq(users.organizationId, params.organizationId),
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

  const updates: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (params.name !== undefined) updates.name = params.name;
  if (params.email !== undefined)
    updates.email = params.email ? normalizeEmail(params.email) : null;
  if (params.phone !== undefined)
    updates.phone = params.phone ? normalizePhone(params.phone) : null;
  if (params.enquiryCategory !== undefined) updates.enquiryCategory = params.enquiryCategory;
  if (params.summary !== undefined) updates.summary = params.summary;
  if (params.status) updates.status = params.status;
  if (params.assignedTo !== undefined) updates.assignedTo = params.assignedTo;

  const [updated] = await db
    .update(leads)
    .set(updates)
    .where(and(eq(leads.id, existing.id), eq(leads.organizationId, params.organizationId)))
    .returning();

  const actions: { action: string; metadata: object }[] = [];
  if (params.status && params.status !== existing.status) {
    actions.push({
      action: 'lead.status_changed',
      metadata: { from: existing.status, to: params.status },
    });
  }
  if (params.assignedTo !== undefined && params.assignedTo !== existing.assignedTo) {
    actions.push({
      action: 'lead.assigned',
      metadata: { from: existing.assignedTo, to: params.assignedTo },
    });
  }
  const changedContactFields = (
    [
      ['email', params.email !== undefined && updates.email !== existing.email],
      ['phone', params.phone !== undefined && updates.phone !== existing.phone],
    ] as const
  )
    .filter(([, changed]) => changed)
    .map(([field]) => field);
  if (changedContactFields.length) {
    actions.push({
      action: 'lead.contact_updated',
      metadata: { fields: changedContactFields },
    });
  }
  if (!actions.length) actions.push({ action: 'lead.updated', metadata: {} });
  for (const a of actions) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: a.action,
      resourceType: 'lead',
      resourceId: updated.id,
      metadata: a.metadata,
    });
  }

  return mapLead(updated);
}

export async function addLeadNote(params: {
  organizationId: string;
  userId: string;
  leadId: string;
  body: string;
}) {
  const lead = await getLeadOrThrow(params.organizationId, params.leadId);
  const [note] = await db
    .insert(leadNotes)
    .values({
      leadId: lead.id,
      organizationId: params.organizationId,
      authorUserId: params.userId,
      body: params.body,
    })
    .returning();

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'lead.note_added',
    resourceType: 'lead',
    resourceId: lead.id,
    metadata: { noteId: note.id },
  });

  return mapNote(note);
}

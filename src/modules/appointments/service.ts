import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  appointments,
  assistantConfigurations,
  chatSessions,
  users,
} from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import { notifyOrganization } from '../notifications/service';
import { normalizeEmail, normalizePhone } from '../leads/service';
import type { AppointmentStatus } from './schemas';

type AppointmentRow = typeof appointments.$inferSelect;

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function isValidAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function toPublicAppointment(row: AppointmentRow, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    status: row.status,
    preferredDate: row.preferredDate,
    preferredTime: row.preferredTime,
    createdAt: row.createdAt,
    ...extra,
  };
}

function mapAppointment(row: AppointmentRow) {
  return row;
}

async function getAppointmentOrThrow(organizationId: string, appointmentId: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Appointment not found');
  return row;
}

async function assertAssignee(organizationId: string, userId: string) {
  const [assignee] = await db
    .select({ id: users.id })
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

export async function requestAppointmentFromPublicSession(params: {
  organizationId: string;
  conversationId: string;
  sessionId: string;
  customerName: string;
  email?: string;
  phone?: string;
  preferredDate: string;
  preferredTime: string;
  reason?: string;
  clientRequestId?: string;
}) {
  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, params.organizationId))
    .limit(1);
  if (!config?.appointmentRequestsEnabled) {
    throw new ApiError(403, 'APPOINTMENTS_DISABLED', 'Appointment requests are not enabled');
  }

  // Structured availability rules configured in the appointments UI. When a
  // rule set exists the requested slot must fall inside it.
  const availability = config.availability as
    | {
        days?: number[];
        open?: string;
        close?: string;
        blackoutDates?: string[];
      }
    | null
    | undefined;
  if (availability && (availability.days || availability.open || availability.close)) {
    const day = new Date(`${params.preferredDate}T00:00:00Z`).getUTCDay();
    if (availability.days && availability.days.length > 0 && !availability.days.includes(day)) {
      throw new ApiError(400, 'OUTSIDE_AVAILABILITY', 'That day is not available for bookings');
    }
    if (availability.blackoutDates?.includes(params.preferredDate)) {
      throw new ApiError(400, 'OUTSIDE_AVAILABILITY', 'That date is not available for bookings');
    }
    if (availability.open && params.preferredTime < availability.open) {
      throw new ApiError(400, 'OUTSIDE_AVAILABILITY', 'Requested time is before opening hours');
    }
    if (availability.close && params.preferredTime >= availability.close) {
      throw new ApiError(400, 'OUTSIDE_AVAILABILITY', 'Requested time is after closing hours');
    }
  }

  const email = params.email ? normalizeEmail(params.email) : undefined;
  const phone = params.phone ? normalizePhone(params.phone) : undefined;
  if (!email && !phone) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'At least one of email or phone is required to request an appointment'
    );
  }

  // Serialize per-session appointment requests under a row lock so concurrent
  // retries collapse onto one record instead of racing the uniqueness check.
  const { appointment, replay } = await db.transaction(async (tx) => {
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
        .from(appointments)
        .where(
          and(
            eq(appointments.conversationId, params.conversationId),
            eq(appointments.clientRequestId, params.clientRequestId)
          )
        )
        .limit(1);
      if (existing) return { appointment: existing, replay: true };
    }

    const [created] = await tx
      .insert(appointments)
      .values({
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        chatSessionId: params.sessionId,
        customerName: params.customerName,
        email: email ?? null,
        phone: phone ?? null,
        preferredDate: params.preferredDate,
        preferredTime: params.preferredTime,
        reason: params.reason ?? null,
        clientRequestId: params.clientRequestId ?? null,
        status: 'REQUESTED',
        source: 'PUBLIC_CHAT',
      })
      .returning();
    return { appointment: created, replay: false };
  });

  if (!replay) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: null,
      action: 'appointment.requested',
      resourceType: 'appointment',
      resourceId: appointment.id,
      metadata: {
        source: 'PUBLIC_CHAT',
        preferredDate: appointment.preferredDate,
        preferredTime: appointment.preferredTime,
      },
    });
    await notifyOrganization({
      organizationId: params.organizationId,
      event: 'appointment.requested',
      subject: 'New appointment request via WymAssist',
      text: `${appointment.customerName} requested ${appointment.preferredDate} at ${appointment.preferredTime}.`,
      link: '/dashboard/assist/appointments',
    });
  }

  return { appointment, idempotentReplay: replay };
}

export async function listAppointments(params: {
  organizationId: string;
  page: number;
  limit: number;
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  assignedTo?: string;
  order: 'asc' | 'desc';
}) {
  const conditions = [eq(appointments.organizationId, params.organizationId)];
  if (params.status) conditions.push(eq(appointments.status, params.status));
  if (params.from) conditions.push(gte(appointments.preferredDate, params.from));
  if (params.to) conditions.push(lte(appointments.preferredDate, params.to));
  if (params.assignedTo) conditions.push(eq(appointments.assignedTo, params.assignedTo));
  const where = and(...conditions);

  const ordering =
    params.order === 'asc'
      ? [asc(appointments.preferredDate), asc(appointments.preferredTime)]
      : [desc(appointments.preferredDate), desc(appointments.preferredTime)];

  const rows = await db
    .select()
    .from(appointments)
    .where(where)
    .orderBy(...ordering)
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totalRow] = await db.select({ value: count() }).from(appointments).where(where);

  return {
    items: rows.map(mapAppointment),
    page: params.page,
    limit: params.limit,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getAppointmentById(organizationId: string, appointmentId: string) {
  return mapAppointment(await getAppointmentOrThrow(organizationId, appointmentId));
}

export async function updateAppointment(params: {
  organizationId: string;
  userId: string;
  appointmentId: string;
  customerName?: string;
  email?: string | null;
  phone?: string | null;
  preferredDate?: string;
  preferredTime?: string;
  reason?: string | null;
  internalNotes?: string | null;
  status?: AppointmentStatus;
  assignedTo?: string | null;
}) {
  const existing = await getAppointmentOrThrow(params.organizationId, params.appointmentId);

  if (
    params.status &&
    !isValidAppointmentTransition(existing.status as AppointmentStatus, params.status)
  ) {
    throw new ApiError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition appointment from ${existing.status} to ${params.status}`
    );
  }

  if (params.assignedTo) await assertAssignee(params.organizationId, params.assignedTo);

  const updates: Partial<typeof appointments.$inferInsert> = { updatedAt: new Date() };
  if (params.customerName !== undefined) updates.customerName = params.customerName;
  if (params.email !== undefined)
    updates.email = params.email ? normalizeEmail(params.email) : null;
  if (params.phone !== undefined)
    updates.phone = params.phone ? normalizePhone(params.phone) : null;
  if (params.preferredDate !== undefined) updates.preferredDate = params.preferredDate;
  if (params.preferredTime !== undefined) updates.preferredTime = params.preferredTime;
  if (params.reason !== undefined) updates.reason = params.reason;
  if (params.internalNotes !== undefined) updates.internalNotes = params.internalNotes;
  if (params.status) updates.status = params.status;
  if (params.assignedTo !== undefined) updates.assignedTo = params.assignedTo;

  const [updated] = await db
    .update(appointments)
    .set(updates)
    .where(
      and(eq(appointments.id, existing.id), eq(appointments.organizationId, params.organizationId))
    )
    .returning();

  const actions: { action: string; metadata: object }[] = [];
  if (params.status && params.status !== existing.status) {
    actions.push({
      action: 'appointment.status_changed',
      metadata: { from: existing.status, to: params.status },
    });
  }
  if (params.assignedTo !== undefined && params.assignedTo !== existing.assignedTo) {
    actions.push({
      action: 'appointment.assigned',
      metadata: { from: existing.assignedTo, to: params.assignedTo },
    });
  }
  if (!actions.length) actions.push({ action: 'appointment.updated', metadata: {} });
  for (const a of actions) {
    await recordAudit({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: a.action,
      resourceType: 'appointment',
      resourceId: updated.id,
      metadata: a.metadata,
    });
  }

  return mapAppointment(updated);
}

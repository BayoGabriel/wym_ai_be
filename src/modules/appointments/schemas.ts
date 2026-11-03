import { z } from 'zod';

export const APPOINTMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const requestAppointmentSchema = z.object({
  customerName: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().min(5).max(64).optional(),
  preferredDate: z.string().regex(datePattern, 'preferredDate must be YYYY-MM-DD'),
  preferredTime: z.string().regex(timePattern, 'preferredTime must be HH:mm (24h)'),
  reason: z.string().trim().min(1).max(1000).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  from: z.string().regex(datePattern).optional(),
  to: z.string().regex(datePattern).optional(),
  assignedTo: z.string().uuid().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const updateAppointmentSchema = z
  .object({
    customerName: z.string().trim().min(1).max(255).optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    phone: z.string().trim().min(5).max(64).nullable().optional(),
    preferredDate: z.string().regex(datePattern).optional(),
    preferredTime: z.string().regex(timePattern).optional(),
    reason: z.string().trim().min(1).max(1000).nullable().optional(),
    internalNotes: z.string().max(4000).nullable().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided',
  });

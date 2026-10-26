import { z } from 'zod';

export const HANDOFF_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'ASSIGNED',
  'RESOLVED',
  'CANCELLED',
] as const;

export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const requestHandoffSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const listHandoffsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(HANDOFF_STATUSES).optional(),
  assignedTo: z.string().uuid().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const assignHandoffSchema = z.object({
  userId: z.string().uuid().nullable(),
});

export const resolveHandoffSchema = z.object({
  resolutionSummary: z.string().trim().min(1).max(1000).optional(),
});

export const cancelHandoffSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const createHandoffNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const staffReplySchema = z.object({
  content: z.string().trim().min(1).max(2000),
  clientRequestId: z.string().min(8).max(128).optional(),
});

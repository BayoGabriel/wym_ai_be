import { z } from 'zod';

export const createConversationSchema = z.object({
  channel: z.enum(['WEB', 'API']).default('API'),
  externalSessionId: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const listConversationsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional(),
  channel: z
    .enum(['WEB', 'API', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'TELEGRAM', 'EMAIL'])
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
  hasLead: z.coerce.boolean().optional(),
  escalated: z.coerce.boolean().optional(),
  assignedTo: z.string().min(1).max(64).optional(), // user id, or 'none'
  tag: z.string().trim().min(1).max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional(),
  metadata: z.record(z.unknown()).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(12).optional(),
});

export const messageFeedbackSchema = z.object({
  feedback: z.enum(['up', 'down']).nullable(),
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  clientRequestId: z.string().min(8).max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

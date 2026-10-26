import { z } from 'zod';

export const createConversationSchema = z.object({
  channel: z.enum(['WEB', 'API']).default('API'),
  externalSessionId: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const listConversationsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const updateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional(),
  metadata: z.record(z.unknown()).optional(),
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

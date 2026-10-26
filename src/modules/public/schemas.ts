import { z } from 'zod';
import { env } from '../../config/env';

export const createPublicSessionSchema = z.object({
  organizationSlug: z.string().min(1).max(255),
  visitorName: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const publicMessageSchema = z.object({
  content: z.string().min(1).max(env.PUBLIC_CHAT_MAX_MESSAGE_LENGTH),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const publicMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

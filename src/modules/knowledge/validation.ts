import { z } from 'zod';
import { env } from '../../config/env';

export const createTextKnowledgeSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(1000).optional(),
  content: z.string().min(1).max(env.MAX_KNOWLEDGE_TEXT_LENGTH),
  category: z.enum(['FAQ', 'EVENTS', 'FEATURES', 'GENERAL']).default('GENERAL'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
});

export const updateKnowledgeSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().max(1000).optional(),
  content: z.string().min(1).max(env.MAX_KNOWLEDGE_TEXT_LENGTH).optional(),
  category: z.enum(['FAQ', 'EVENTS', 'FEATURES', 'GENERAL']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
});

export const uploadPdfSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(['FAQ', 'EVENTS', 'FEATURES', 'GENERAL']).default('GENERAL'),
  fileName: z.string().min(1),
  mimeType: z.string().refine((t) => t === 'application/pdf', 'Invalid MIME type'),
  base64: z.string().min(1),
});

export const listQuerySchema = z.object({
  category: z.enum(['FAQ', 'EVENTS', 'FEATURES', 'GENERAL']).optional(),
  sourceType: z.enum(['TEXT', 'PDF']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

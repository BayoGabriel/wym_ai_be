import { z } from 'zod';
import { env } from '../../config/env';

export const KNOWLEDGE_CATEGORIES = [
  'FAQ',
  'EVENTS',
  'FEATURES',
  'GENERAL',
  'COMPANY_INFO',
  'SERVICES',
  'POLICIES',
  'PRICING',
  'PROCEDURES',
] as const;

export const createTextKnowledgeSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(1000).optional(),
  content: z.string().min(1).max(env.MAX_KNOWLEDGE_TEXT_LENGTH),
  category: z.enum(KNOWLEDGE_CATEGORIES).default('GENERAL'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
});

export const updateKnowledgeSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().max(1000).optional(),
  content: z.string().min(1).max(env.MAX_KNOWLEDGE_TEXT_LENGTH).optional(),
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
});

export const uploadPdfSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(KNOWLEDGE_CATEGORIES).default('GENERAL'),
  fileName: z.string().min(1),
  mimeType: z
    .string()
    .refine(
      (t) =>
        [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'text/csv',
          'application/csv',
        ].includes(t),
      'Invalid MIME type'
    ),
  base64: z.string().min(1),
});

export const listQuerySchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  sourceType: z.enum(['TEXT', 'PDF']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

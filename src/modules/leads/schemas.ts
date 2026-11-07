import { z } from 'zod';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;
export const LEAD_CATEGORIES = ['GENERAL', 'SALES', 'SUPPORT', 'FEEDBACK', 'OTHER'] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadCategory = (typeof LEAD_CATEGORIES)[number];

export const captureLeadSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().min(5).max(64).optional(),
  enquiryCategory: z.enum(LEAD_CATEGORIES).optional(),
  summary: z.string().trim().min(1).max(1000).optional(),
  consentToContact: z.boolean().optional(),
  // Answers to the organization's configured intake fields (assistant config).
  customFields: z.record(z.union([z.string().trim().max(500), z.boolean()])).optional(),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(20),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.string().max(64).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  category: z.enum(LEAD_CATEGORIES).optional(),
  assignedTo: z.string().uuid().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1).max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().min(5).max(64).nullable().optional(),
  enquiryCategory: z.enum(LEAD_CATEGORIES).nullable().optional(),
  summary: z.string().trim().min(1).max(1000).nullable().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const createLeadNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

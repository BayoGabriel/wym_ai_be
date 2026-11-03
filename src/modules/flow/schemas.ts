import { z } from 'zod';

const flowFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'key must be snake_case (a-z, 0-9, _)'),
  label: z.string().trim().min(1).max(255),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
});

const flowStepSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
});

export const createFlowDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  fields: z.array(flowFieldSchema).max(50).default([]),
  steps: z.array(flowStepSchema).min(1, 'At least one approval step is required').max(20),
  active: z.boolean().default(true),
});

export const updateFlowDefinitionSchema = createFlowDefinitionSchema.partial();

export const submitFlowInstanceSchema = z.object({
  definitionId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  data: z.record(z.union([z.string().max(4000), z.number(), z.boolean()])).default({}),
  documents: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        contentBase64: z.string().min(1),
      })
    )
    .max(5)
    .default([]),
});

export const listInstancesQuerySchema = z.object({
  status: z.enum(['IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  definitionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listTasksQuerySchema = z.object({
  mine: z.coerce.boolean().optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const taskDecisionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const assignTaskSchema = z.object({
  assignedTo: z.string().uuid().nullable(),
});

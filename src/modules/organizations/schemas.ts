import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/),
  status: z.enum(['pending', 'active', 'suspended', 'archived']).default('active'),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z.enum(['pending', 'active', 'suspended', 'archived']).optional(),
});

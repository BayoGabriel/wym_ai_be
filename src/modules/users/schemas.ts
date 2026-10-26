import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  organizationId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'suspended']).default('active').optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  password: z.string().min(8).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

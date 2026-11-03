import { z } from 'zod';
import { env } from '../../config/env';

// Identify the org by its rotatable public key (preferred) or its slug
// (legacy embeds). At least one is required.
const orgRefShape = {
  organizationSlug: z.string().min(1).max(255).optional(),
  organizationKey: z.string().min(1).max(64).optional(),
};
const requireOrgRef = <T extends { organizationSlug?: string; organizationKey?: string }>(
  v: T
) => !!(v.organizationSlug || v.organizationKey);

export const createPublicSessionSchema = z
  .object({
    ...orgRefShape,
    visitorName: z.string().min(1).max(255).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(requireOrgRef, { message: 'organizationKey or organizationSlug is required' });

export const publicMessageSchema = z.object({
  content: z.string().min(1).max(env.PUBLIC_CHAT_MAX_MESSAGE_LENGTH),
  clientRequestId: z.string().min(8).max(128).optional(),
});

export const publicConfigQuerySchema = z
  .object(orgRefShape)
  .refine(requireOrgRef, { message: 'organizationKey or organizationSlug is required' });

export const publicMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

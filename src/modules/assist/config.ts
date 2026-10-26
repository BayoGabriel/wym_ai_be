import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { db } from '../../database/client';
import { assistantConfigurations } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';
import { normalizeOrigin } from '../public/service';

const originEntrySchema = z
  .string()
  .min(1)
  .max(512)
  .transform((v, ctx) => {
    const normalized = normalizeOrigin(v);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid origin (must be http(s)://host[:port]): ${v}`,
      });
      return z.NEVER;
    }
    return normalized;
  });

const updateAssistSchema = z.object({
  assistantName: z.string().min(1).optional(),
  welcomeMessage: z.string().optional(),
  businessDescription: z.string().optional(),
  tone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  operatingHours: z.string().optional(),
  escalationEnabled: z.boolean().optional(),
  leadCaptureEnabled: z.boolean().optional(),
  appointmentRequestsEnabled: z.boolean().optional(),
  publicChatEnabled: z.boolean().optional(),
  allowedOrigins: z.array(originEntrySchema).max(50).optional(),
});

const router = Router();

function mapConfig(row: any) {
  if (!row) return {};
  let origins: string[] = [];
  if (typeof row.allowedOrigins === 'string' && row.allowedOrigins) {
    try {
      const parsed = JSON.parse(row.allowedOrigins);
      if (Array.isArray(parsed)) origins = parsed;
    } catch {
      origins = [];
    }
  }
  return { ...row, allowedOrigins: origins };
}

router.get('/', authenticate, async (req, res) => {
  const auth = (req as any).auth;
  if (!auth.organizationId)
    return res
      .status(400)
      .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
  const [row] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, auth.organizationId))
    .limit(1);
  return res.json(mapConfig(row));
});

router.patch('/', authenticate, validate(updateAssistSchema), async (req, res) => {
  const auth = (req as any).auth;
  if (!auth.organizationId)
    return res
      .status(400)
      .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
  const updates = { ...(req.body as any) };
  if (Array.isArray(updates.allowedOrigins)) {
    updates.allowedOrigins = JSON.stringify([...new Set(updates.allowedOrigins)]);
  }
  const existing = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, auth.organizationId))
    .limit(1);
  let row;
  if (existing.length === 0) {
    [row] = await db
      .insert(assistantConfigurations)
      .values({ organizationId: auth.organizationId, ...updates })
      .returning();
  } else {
    [row] = await db
      .update(assistantConfigurations)
      .set(updates)
      .where(eq(assistantConfigurations.organizationId, auth.organizationId))
      .returning();
  }
  await recordAudit({
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'assist.config.updated',
    resourceType: 'assistant_configurations',
    resourceId: auth.organizationId,
    metadata: { fields: Object.keys(updates) },
  });
  return res.json(mapConfig(row));
});

export default router;

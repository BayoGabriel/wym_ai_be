import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { db } from '../../database/client';
import { assistantConfigurations } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';
import { normalizeOrigin } from '../public/service';
import { requirePermission } from '../rbac/authz';
import { AuthContext } from '../../types/auth';

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

export const intakeFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'key must be snake_case (a-z, 0-9, _)'),
  label: z.string().trim().min(1).max(255),
  type: z.enum(['text', 'select', 'checkbox']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
});

// PATCH semantics: '' means "clear this field" → store NULL.
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const nullableField = <S extends z.ZodType>(schema: S) =>
  z.preprocess(emptyToNull, schema.nullable()).optional();

const updateAssistSchema = z.object({
  assistantName: nullableField(z.string().min(1).max(255)),
  welcomeMessage: nullableField(z.string()),
  businessDescription: nullableField(z.string()),
  tone: nullableField(z.string().max(64)),
  contactEmail: nullableField(z.string().email().max(255)),
  contactPhone: nullableField(z.string().max(64)),
  operatingHours: nullableField(z.string()),
  escalationEnabled: z.boolean().optional(),
  leadCaptureEnabled: z.boolean().optional(),
  appointmentRequestsEnabled: z.boolean().optional(),
  publicChatEnabled: z.boolean().optional(),
  allowedOrigins: z.array(originEntrySchema).max(50).optional(),
  intakeFields: z.array(intakeFieldSchema).max(50).nullable().optional(),
  notificationEmail: nullableField(z.string().email().max(255)),
  notifyOnLead: z.boolean().optional(),
  notifyOnHandoff: z.boolean().optional(),
  notifyOnAppointment: z.boolean().optional(),
});

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function mapConfig(row: typeof assistantConfigurations.$inferSelect | undefined) {
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

router.get(
  '/',
  authenticate,
  handle(async (req, res) => {
    const auth = req.auth;
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
  })
);

router.patch(
  '/',
  authenticate,
  validate(updateAssistSchema),
  handle(async (req, res) => {
    const auth = req.auth as AuthContext;
    requirePermission(auth, 'organization.update');
    if (!auth.organizationId)
      return res
        .status(400)
        .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
    const updates = { ...(req.body) };
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
  })
);

export default router;

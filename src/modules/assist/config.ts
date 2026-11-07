import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { db } from '../../database/client';
import { assistantConfigurations } from '../../database/schema/core';
import { eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';
import { normalizeOrigin } from '../public/service';
import { isTrialOnly } from '../products/service';
import { ApiError } from '../../middleware/error';
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
  type: z.enum([
    'text',
    'select',
    'checkbox',
    'phone',
    'email',
    'date',
    'time',
    'textarea',
    'consent',
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  placeholder: z.string().max(255).optional(),
  helpText: z.string().max(500).optional(),
});

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const availabilitySchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).max(7), // 0 = Sunday
    open: timeOfDay,
    close: timeOfDay,
    slotMinutes: z.number().int().min(5).max(480).default(30),
    bufferMinutes: z.number().int().min(0).max(240).default(0),
    blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).default([]),
  })
  .refine((v) => v.open < v.close, { message: 'open must be before close' });

export const guardrailsSchema = z.object({
  fallbackMessage: z.string().max(2000).optional(),
  escalationTriggers: z.array(z.string().max(255)).max(50).optional(),
  restrictedTopics: z.array(z.string().max(255)).max(50).optional(),
  medicalSafetyMode: z.boolean().optional(),
});

export const widgetAppearanceSchema = z.object({
  position: z.enum(['left', 'right']).optional(),
  shape: z.enum(['rounded', 'square', 'circle']).optional(),
  size: z.enum(['compact', 'comfortable']).optional(),
  mode: z.enum(['light', 'dark', 'auto']).optional(),
  greeting: z.string().max(255).optional(),
  subtitle: z.string().max(255).optional(),
});

// PATCH semantics: '' means "clear this field" → store NULL.
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const nullableField = <S extends z.ZodType>(schema: S) =>
  z.preprocess(emptyToNull, schema.nullable()).optional();

export const updateAssistSchema = z.object({
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
  availability: availabilitySchema.nullable().optional(),
  guardrails: guardrailsSchema.nullable().optional(),
  widgetAppearance: widgetAppearanceSchema.nullable().optional(),
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

export function mapConfig(row: typeof assistantConfigurations.$inferSelect | undefined) {
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
      const origins = [...new Set(updates.allowedOrigins as string[])];
      // Free trials may bind the widget to a single website, and one origin
      // can only ever power one trial — stops multi-account embed abuse.
      if (origins.length > 0 && (await isTrialOnly(auth.organizationId))) {
        if (origins.length > 1) {
          throw new ApiError(
            400,
            'TRIAL_ORIGIN_LIMIT',
            'Free trials can embed the assistant on one website — upgrade to add more.'
          );
        }
        const claimed = await db
          .select({
            organizationId: assistantConfigurations.organizationId,
            allowedOrigins: assistantConfigurations.allowedOrigins,
          })
          .from(assistantConfigurations)
          .where(ne(assistantConfigurations.organizationId, auth.organizationId));
        const taken = claimed.some((o) => {
          try {
            const arr = JSON.parse(o.allowedOrigins ?? '[]');
            return Array.isArray(arr) && arr.includes(origins[0]);
          } catch {
            return false;
          }
        });
        if (taken) {
          throw new ApiError(
            409,
            'ORIGIN_IN_USE',
            'That website is already connected to another account.'
          );
        }
      }
      updates.allowedOrigins = JSON.stringify(origins);
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

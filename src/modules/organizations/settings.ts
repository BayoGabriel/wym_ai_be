import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { db } from '../../database/client';
import { organizationSettings } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';
import { requirePermission } from '../rbac/authz';
import { AuthContext } from '../../types/auth';

// PATCH semantics: '' means "clear this field" → store NULL.
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const nullableField = <S extends z.ZodType>(schema: S) =>
  z.preprocess(emptyToNull, schema.nullable()).optional();

export const updateSettingsSchema = z.object({
  businessName: nullableField(z.string().min(1).max(255)),
  businessCategory: nullableField(z.string().min(1).max(255)),
  website: nullableField(z.string().url().max(512)),
  contactEmail: nullableField(z.string().email().max(255)),
  contactPhone: nullableField(z.string().min(3).max(64)),
  address: nullableField(z.string()),
  timezone: nullableField(z.string().max(64)),
  defaultLanguage: nullableField(z.string().min(2).max(16)),
  active: z.boolean().optional(),
  logoUrl: nullableField(z.string().url().max(1024)),
  primaryColor: nullableField(z.string().min(1).max(16)),
  secondaryColor: nullableField(z.string().min(1).max(16)),
  whatsappPhoneNumberId: nullableField(
    z.string().regex(/^\d{5,32}$/, 'Must be the Meta phone_number_id (digits)')
  ),
  messengerPageId: nullableField(
    z.string().regex(/^\d{5,32}$/, 'Must be the Facebook Page ID (digits)')
  ),
  instagramAccountId: nullableField(
    z.string().regex(/^\d{5,32}$/, 'Must be the Instagram professional account ID (digits)')
  ),
  telegramBotToken: nullableField(
    z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,}$/, 'Must be a Telegram bot token')
  ),
  inboundEmailAddress: nullableField(z.string().email().max(255)),
});

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Secrets are write-only: the token is replaced by a boolean so clients know
// one is configured without ever receiving it back.
export function presentSettings(row: typeof organizationSettings.$inferSelect | undefined) {
  if (!row) return {};
  const { telegramBotToken, ...rest } = row;
  return { ...rest, telegramBotConfigured: Boolean(telegramBotToken) };
}

router.get(
  '/settings',
  authenticate,
  handle(async (req, res) => {
    const auth = req.auth;
    requirePermission(auth, 'organization.read');
    if (!auth.organizationId)
      return res
        .status(400)
        .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
    const [row] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, auth.organizationId))
      .limit(1);
    return res.json(presentSettings(row));
  })
);

router.patch(
  '/settings',
  authenticate,
  validate(updateSettingsSchema),
  handle(async (req, res) => {
    const auth = req.auth as AuthContext;
    requirePermission(auth, 'organization.update');
    if (!auth.organizationId)
      return res
        .status(400)
        .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
    const updates = req.body;
    const existing = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, auth.organizationId))
      .limit(1);
    let row;
    if (existing.length === 0) {
      [row] = await db
        .insert(organizationSettings)
        .values({ organizationId: auth.organizationId, ...updates })
        .returning();
    } else {
      [row] = await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.organizationId, auth.organizationId))
        .returning();
    }
    await recordAudit({
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action: 'organization.settings.updated',
      resourceType: 'organization_settings',
      resourceId: auth.organizationId,
      metadata: { fields: Object.keys(updates) },
    });
    return res.json(presentSettings(row));
  })
);

export default router;

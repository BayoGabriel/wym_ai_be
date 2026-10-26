import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { db } from '../../database/client';
import { organizationSettings } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';

const updateSettingsSchema = z.object({
  businessName: z.string().min(1).optional(),
  businessCategory: z.string().min(1).optional(),
  website: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(3).optional(),
  address: z.string().optional(),
  timezone: z.string().optional(),
  defaultLanguage: z.string().min(2).max(16).optional(),
  active: z.boolean().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
});

const router = Router();

router.get('/settings', authenticate, async (req, res) => {
  const auth = (req as any).auth;
  if (!auth.organizationId)
    return res
      .status(400)
      .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
  const [row] = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, auth.organizationId))
    .limit(1);
  return res.json(row ?? {});
});

router.patch('/settings', authenticate, validate(updateSettingsSchema), async (req, res) => {
  const auth = (req as any).auth;
  if (!auth.organizationId)
    return res
      .status(400)
      .json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
  const updates = req.body as any;
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
  return res.json(row);
});

export default router;

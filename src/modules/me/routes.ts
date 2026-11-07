import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { db } from '../../database/client';
import {
  auditEvents,
  plans,
  refreshTokens,
  subscriptions,
  products,
  usageRecords,
  userPreferences,
  users,
} from '../../database/schema/core';
import { AuthContext } from '../../types/auth';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function authOf(req: Request): AuthContext {
  return (req as unknown as { auth: AuthContext }).auth;
}

router.use(authenticate);

/* ---------- Active sessions (refresh tokens) ---------- */

router.get(
  '/me/sessions',
  handle(async (req, res) => {
    const auth = authOf(req);
    const rows = await db
      .select({ id: refreshTokens.id, createdAt: refreshTokens.createdAt, expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, auth.userId), isNull(refreshTokens.revokedAt), gte(refreshTokens.expiresAt, new Date())))
      .orderBy(desc(refreshTokens.createdAt));
    res.json({ items: rows });
  })
);

router.delete(
  '/me/sessions/:id',
  handle(async (req, res) => {
    const auth = authOf(req);
    const [row] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, req.params.id), eq(refreshTokens.userId, auth.userId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Session not found');
    res.status(204).send();
  })
);

/* ---------- Notification preferences ---------- */

const prefsSchema = z.object({
  notifyEmail: z.record(z.boolean()).optional(),
  notifyInApp: z.record(z.boolean()).optional(),
});

async function getPrefsRow(userId: string, organizationId: string | null) {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(userPreferences)
    .values({ userId, organizationId })
    .returning();
  return created;
}

router.get(
  '/me/preferences',
  handle(async (req, res) => {
    const auth = authOf(req);
    const row = await getPrefsRow(auth.userId, auth.organizationId);
    res.json({
      notifyEmail: JSON.parse(row.notifyEmail || '{}'),
      notifyInApp: JSON.parse(row.notifyInApp || '{}'),
    });
  })
);

router.patch(
  '/me/preferences',
  validate(prefsSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    const existing = await getPrefsRow(auth.userId, auth.organizationId);
    const body = req.body as { notifyEmail?: Record<string, boolean>; notifyInApp?: Record<string, boolean> };
    const next = {
      notifyEmail: JSON.stringify({ ...JSON.parse(existing.notifyEmail || '{}'), ...(body.notifyEmail ?? {}) }),
      notifyInApp: JSON.stringify({ ...JSON.parse(existing.notifyInApp || '{}'), ...(body.notifyInApp ?? {}) }),
      updatedAt: new Date(),
    };
    await db.update(userPreferences).set(next).where(eq(userPreferences.userId, auth.userId));
    res.json({ notifyEmail: JSON.parse(next.notifyEmail), notifyInApp: JSON.parse(next.notifyInApp) });
  })
);

/* ---------- Data export ---------- */

router.get(
  '/me/export',
  handle(async (req, res) => {
    const auth = authOf(req);
    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, auth.userId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(500);
    const notifs = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, auth.organizationId ?? ''), eq(auditEvents.actorUserId, auth.userId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(500);
    res.json({
      exportedAt: new Date().toISOString(),
      user: user && { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
      activity: audits,
      orgActivityAuthored: notifs,
    });
  })
);

/* ---------- Org audit feed (admin) ---------- */

router.get(
  '/audit/events',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'organization.read');
    if (!auth.organizationId) throw new ApiError(403, 'FORBIDDEN', 'No organization');
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
        actor: users.name,
        actorEmail: users.email,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.actorUserId, users.id))
      .where(eq(auditEvents.organizationId, auth.organizationId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    res.json({ items: rows });
  })
);

/* ---------- Billing summary ---------- */

router.get(
  '/billing/summary',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'subscription.read');
    if (!auth.organizationId) throw new ApiError(403, 'FORBIDDEN', 'No organization');

    const subs = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        startAt: subscriptions.startAt,
        endAt: subscriptions.endAt,
        productName: products.name,
        productCode: products.code,
        planName: plans.name,
        planCode: plans.code,
        monthlyPriceCents: plans.monthlyPriceCents,
        maxSeats: plans.maxSeats,
        maxKnowledgeItems: plans.maxKnowledgeItems,
        maxMonthlyConversations: plans.maxMonthlyConversations,
        maxMonthlyAiMessages: plans.maxMonthlyAiMessages,
      })
      .from(subscriptions)
      .leftJoin(products, eq(subscriptions.productId, products.id))
      .leftJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.organizationId, auth.organizationId));

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [seatRows, usage] = await Promise.all([
      db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, auth.organizationId), eq(users.status, 'active'))),
      db
        .select({ eventType: usageRecords.eventType, quantity: usageRecords.quantity })
        .from(usageRecords)
        .where(and(eq(usageRecords.organizationId, auth.organizationId), gte(usageRecords.createdAt, monthStart))),
    ]);
    const usageByType: Record<string, number> = {};
    for (const u of usage) usageByType[u.eventType] = (usageByType[u.eventType] ?? 0) + u.quantity;

    res.json({
      subscriptions: subs.map((s) => ({
        ...s,
        trialDaysLeft:
          s.trialEndsAt && s.trialEndsAt.getTime() > Date.now()
            ? Math.ceil((s.trialEndsAt.getTime() - Date.now()) / 86_400_000)
            : null,
      })),
      usage: { seats: seatRows.length, ...usageByType },
      plans: await db.select().from(plans).orderBy(plans.monthlyPriceCents),
    });
  })
);

export default router;

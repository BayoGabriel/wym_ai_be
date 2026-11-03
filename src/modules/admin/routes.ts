import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  auditEvents,
  conversations,
  leads,
  messages,
  organizations,
  products,
  subscriptions,
  usageRecords,
  users,
} from '../../database/schema/core';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';
import { ApiError } from '../../middleware/error';
import { AuthContext } from '../../types/auth';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.use(authenticate);

function requirePlatformManage(req: Request): AuthContext {
  const auth = (req as unknown as { auth: AuthContext }).auth;
  requirePermission(auth, 'platform.manage');
  return auth;
}

// ---------------------------------------------------------------------------
// Platform usage overview: org counts, per-org volumes, usage-record totals.
// ---------------------------------------------------------------------------
router.get(
  '/usage',
  handle(async (_req, res) => {
    requirePlatformManage(_req);

    const [orgsByStatus, perOrg, usageTotals] = await Promise.all([
      db
        .select({ status: organizations.status, value: count() })
        .from(organizations)
        .groupBy(organizations.status),
      db
        .select({
          organizationId: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          status: organizations.status,
          userCount: sql<number>`(select count(*) from ${users} u where u.organization_id = ${organizations.id})`,
          conversationCount: sql<number>`(select count(*) from ${conversations} c where c.organization_id = ${organizations.id})`,
          messageCount: sql<number>`(select count(*) from ${messages} m where m.organization_id = ${organizations.id})`,
          leadCount: sql<number>`(select count(*) from ${leads} l where l.organization_id = ${organizations.id})`,
        })
        .from(organizations)
        .orderBy(organizations.name),
      db
        .select({
          eventType: usageRecords.eventType,
          value: sql<number>`coalesce(sum(${usageRecords.quantity}),0)`,
        })
        .from(usageRecords)
        .groupBy(usageRecords.eventType),
    ]);

    res.json({
      organizations: {
        byStatus: orgsByStatus.map((r) => ({ status: r.status, count: Number(r.value) })),
        total: orgsByStatus.reduce((s, r) => s + Number(r.value), 0),
      },
      usageTotals: (usageTotals as { eventType: string; value: number }[]).map((r) => ({
        eventType: r.eventType,
        quantity: Number(r.value),
      })),
      perOrganization: perOrg.map((r) => ({
        ...r,
        userCount: Number(r.userCount),
        conversationCount: Number(r.conversationCount),
        messageCount: Number(r.messageCount),
        leadCount: Number(r.leadCount),
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// Subscription management (platform-level billing lifecycle records).
// ---------------------------------------------------------------------------
const subscriptionSchema = z.object({
  organizationId: z.string().uuid(),
  productCode: z.string().regex(/^[A-Z0-9_]+$/),
  status: z.enum(['trialing', 'active', 'suspended', 'cancelled', 'expired']).default('trialing'),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
});

const updateSubscriptionSchema = z.object({
  status: z.enum(['trialing', 'active', 'suspended', 'cancelled', 'expired']).optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
});

router.get(
  '/subscriptions',
  handle(async (_req, res) => {
    requirePlatformManage(_req);
    const rows = await db
      .select({
        id: subscriptions.id,
        organizationId: subscriptions.organizationId,
        organizationName: organizations.name,
        productId: subscriptions.productId,
        productCode: products.code,
        status: subscriptions.status,
        startAt: subscriptions.startAt,
        endAt: subscriptions.endAt,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .leftJoin(organizations, eq(subscriptions.organizationId, organizations.id))
      .leftJoin(products, eq(subscriptions.productId, products.id))
      .orderBy(desc(subscriptions.createdAt));
    res.json(rows);
  })
);

router.post(
  '/subscriptions',
  validate(subscriptionSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const body = req.body as z.infer<typeof subscriptionSchema>;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, body.organizationId))
      .limit(1);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.code, body.productCode))
      .limit(1);
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found');

    const [row] = await db
      .insert(subscriptions)
      .values({
        organizationId: body.organizationId,
        productId: product.id,
        status: body.status,
        startAt: body.startAt ?? new Date(),
        endAt: body.endAt ?? null,
      })
      .returning();

    await recordAudit({
      organizationId: body.organizationId,
      actorUserId: auth.userId,
      action: 'subscription.created',
      resourceType: 'subscription',
      resourceId: row.id,
      metadata: { productCode: body.productCode, status: body.status },
    });
    res.status(201).json(row);
  })
);

router.patch(
  '/subscriptions/:id',
  validate(updateSubscriptionSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, req.params.id))
      .limit(1);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Subscription not found');

    const body = req.body as z.infer<typeof updateSubscriptionSchema>;
    const [row] = await db
      .update(subscriptions)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id))
      .returning();

    await recordAudit({
      organizationId: existing.organizationId,
      actorUserId: auth.userId,
      action: 'subscription.updated',
      resourceType: 'subscription',
      resourceId: row.id,
      metadata: { changes: body },
    });
    res.json(row);
  })
);

// ---------------------------------------------------------------------------
// Platform-wide audit feed: most recent events across all organizations.
// ---------------------------------------------------------------------------
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  organizationId: z.string().uuid().optional(),
});

router.get(
  '/audit-events',
  validate(auditQuerySchema, 'query'),
  handle(async (req, res) => {
    requirePlatformManage(req);
    const query = req.query as unknown as { limit: number; organizationId?: string };
    const rows = await db
      .select()
      .from(auditEvents)
      .where(
        query.organizationId ? eq(auditEvents.organizationId, query.organizationId) : undefined
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(query.limit);
    res.json(rows);
  })
);

// ---------------------------------------------------------------------------
// Client account lifecycle: suspend / activate organizations.
// ---------------------------------------------------------------------------
const orgStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });

router.post(
  '/organizations/:id/status',
  validate(orgStatusSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.id))
      .limit(1);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');

    const status = (req.body as { status: 'active' | 'suspended' }).status;
    const [updated] = await db
      .update(organizations)
      .set({ status, updatedAt: new Date() })
      .where(eq(organizations.id, org.id))
      .returning();

    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: `organization.${status === 'active' ? 'activated' : 'suspended'}`,
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { from: org.status, to: status },
    });
    res.json(updated);
  })
);

export default router;

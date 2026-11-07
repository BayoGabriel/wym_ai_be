import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '../../database/client';
import {
  appointments,
  assistantConfigurations,
  auditEvents,
  chatSessions,
  conversations,
  datasets,
  flowActivities,
  flowDefinitions,
  flowInstances,
  flowTasks,
  handoffNotes,
  handoffs,
  insightReports,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeItems,
  leadNotes,
  leads,
  messages,
  notifications,
  organizationProducts,
  organizationSettings,
  organizations,
  passwordResetTokens,
  plans,
  products,
  refreshTokens,
  reportSchedules,
  roles,
  subscriptions,
  usageRecords,
  userPreferences,
  userRoles,
  users,
} from '../../database/schema/core';
import { createPasswordResetToken, hashPassword } from '../auth/service';
import { getMailTransport } from '../mail/transport';
import { newPublicKey } from '../../lib/keys';
import { env } from '../../config/env';
import { mapConfig, updateAssistSchema } from '../assist/config';
import { presentSettings, updateSettingsSchema } from '../organizations/settings';
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
          id: organizations.id,
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
// Audited impersonation / view-as. Platform admins receive a 30-minute token
// for a user inside the target org; every mutation under it is logged as
// admin.impersonated_action (see authenticate middleware).
// ---------------------------------------------------------------------------
router.post(
  '/organizations/:id/impersonate',
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const { issueImpersonationToken } = await import('../auth/service');
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, req.params.id))
      .limit(1);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');

    // Prefer a Client Administrator; fall back to any active org member.
    const candidates = await db
      .select({ id: users.id, name: users.name, email: users.email, roleName: roles.name })
      .from(users)
      .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.organizationId, org.id)))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(users.organizationId, org.id), eq(users.status, 'active')))
      .limit(50);
    const target =
      candidates.find((u) => u.roleName === 'Client Administrator') ?? candidates[0];
    if (!target)
      throw new ApiError(400, 'NO_USERS', 'No active users in this organization to view as');

    const accessToken = issueImpersonationToken({
      userId: target.id,
      organizationId: org.id,
      adminUserId: auth.userId,
    });
    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: 'admin.impersonation.started',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { asUser: target.id, asUserEmail: target.email },
    });
    res.json({ accessToken, user: target, organization: { id: org.id, name: org.name }, expiresIn: 1800 });
  })
);

router.post(
  '/impersonation/end',
  handle(async (req, res) => {
    const auth = (req as unknown as { auth: AuthContext }).auth;
    if (auth.impersonatedBy) {
      await recordAudit({
        organizationId: auth.organizationId,
        actorUserId: auth.impersonatedBy,
        action: 'admin.impersonation.ended',
        resourceType: 'organization',
        resourceId: auth.organizationId,
        metadata: { asUser: auth.userId },
      });
    }
    res.status(204).send();
  })
);

// Platform overview: orgs, subscriptions, trials expiring, MRR estimate.
router.get(
  '/overview',
  handle(async (req, res) => {
    requirePlatformManage(req);
    const trialWindow = new Date(Date.now() + 14 * 86_400_000);
    const [orgsByStatus, subsByStatus, trialRows, mrrRows] = await Promise.all([
      db.select({ status: organizations.status, value: count() }).from(organizations).groupBy(organizations.status),
      db.select({ status: subscriptions.status, value: count() }).from(subscriptions).groupBy(subscriptions.status),
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          trialEndsAt: subscriptions.trialEndsAt,
        })
        .from(subscriptions)
        .innerJoin(organizations, eq(subscriptions.organizationId, organizations.id))
        .where(
          and(
            eq(subscriptions.status, 'trialing'),
            sql`${subscriptions.trialEndsAt} is not null and ${subscriptions.trialEndsAt} <= ${trialWindow}`
          )
        )
        .orderBy(subscriptions.trialEndsAt),
      db
        .select({ value: sql<number>`coalesce(sum(${plans.monthlyPriceCents}),0)` })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(eq(subscriptions.status, 'active')),
    ]);
    res.json({
      organizations: {
        total: orgsByStatus.reduce((s, r) => s + Number(r.value), 0),
        byStatus: orgsByStatus.map((r) => ({ status: r.status, count: Number(r.value) })),
      },
      subscriptions: {
        byStatus: subsByStatus.map((r) => ({ status: r.status, count: Number(r.value) })),
      },
      mrrCents: Number(mrrRows[0]?.value ?? 0),
      trialsExpiring: trialRows.map((t) => ({
        ...t,
        daysLeft: t.trialEndsAt
          ? Math.max(0, Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000))
          : null,
      })),
    });
  })
);

// Onboarding wizard — the platform team drafts a client before registering.
router.get(
  '/organizations/:id/onboarding',
  handle(async (req, res) => {
    requirePlatformManage(req);
    const [org] = await db
      .select({ onboardingDraft: organizations.onboardingDraft })
      .from(organizations)
      .where(eq(organizations.id, req.params.id))
      .limit(1);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    res.json({ draft: org.onboardingDraft ? JSON.parse(org.onboardingDraft) : null });
  })
);

router.patch(
  '/organizations/:id/onboarding',
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const [org] = await db
      .update(organizations)
      .set({ onboardingDraft: JSON.stringify(req.body ?? {}) })
      .where(eq(organizations.id, req.params.id))
      .returning({ id: organizations.id });
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
    await recordAudit({
      organizationId: req.params.id,
      actorUserId: auth.userId,
      action: 'admin.onboarding.draft_saved',
      resourceType: 'organization',
      resourceId: req.params.id,
    });
    res.json({ draft: req.body });
  })
);

// Industry templates — applies a preset config + seeds starter FAQs.
const TEMPLATES: Record<string, { intakeFields: object[]; guardrails: object; welcomeMessage: string; faqs: { title: string; content: string }[] }> = {
  dental_clinic: {
    welcomeMessage: 'Hi! How can I help you today — booking, questions about treatments, or our location?',
    intakeFields: [
      { key: 'name', label: 'Your name', type: 'text', required: true },
      { key: 'phone', label: 'Phone number', type: 'phone', required: true },
      { key: 'reason', label: 'Reason for visit', type: 'select', options: ['Check-up', 'Tooth pain', 'Cleaning', 'Other'], required: true },
      { key: 'preferred_date', label: 'Preferred date', type: 'date', required: false },
    ],
    guardrails: { medicalSafetyMode: true, restrictedTopics: ['medication dosing', 'diagnosis'] },
    faqs: [
      { title: 'How do I book an appointment?', content: 'You can book directly through this chat — tell me your preferred date and time and we\'ll request the slot for you.' },
      { title: 'Do you accept emergencies?', content: 'Yes — tell us you\'re in pain and we\'ll escalate to the front desk immediately so a human can help you.' },
      { title: 'What are your opening hours?', content: 'We\'re open Monday–Friday 9:00–17:00. Bookings outside those hours are requested, not guaranteed.' },
    ],
  },
  salon: {
    welcomeMessage: 'Hi there! Want to book an appointment or ask about our services?',
    intakeFields: [
      { key: 'name', label: 'Your name', type: 'text', required: true },
      { key: 'phone', label: 'Phone number', type: 'phone', required: true },
      { key: 'service', label: 'Service', type: 'select', options: ['Haircut', 'Colour', 'Treatment', 'Consultation'], required: true },
    ],
    guardrails: {},
    faqs: [
      { title: 'How do I book?', content: 'Tell me which service you need and when — I\'ll put in a request for you.' },
      { title: 'Can I cancel or reschedule?', content: 'Yes, just let us know in chat and we\'ll connect you to the team to rearrange.' },
    ],
  },
  saas_support: {
    welcomeMessage: 'Hi! I can help with product questions, billing, or connect you to support.',
    intakeFields: [
      { key: 'email', label: 'Work email', type: 'email', required: true },
      { key: 'topic', label: 'Topic', type: 'select', options: ['Billing', 'Bug report', 'Feature request', 'Account access'], required: true },
      { key: 'details', label: 'Tell us more', type: 'textarea', required: false },
    ],
    guardrails: { escalationTriggers: ['legal', 'security incident', 'outage', 'data breach'] },
    faqs: [
      { title: 'How do I reset my password?', content: 'Use the reset-password link on the sign-in page, or ask me to escalate to your admin.' },
      { title: 'Where can I see system status?', content: 'Our status page is linked from the product — if you\'re seeing an outage, tell me and I\'ll escalate it to the on-call team.' },
    ],
  },
};

router.post(
  '/organizations/:id/apply-template',
  validate(z.object({ template: z.enum(['dental_clinic', 'salon', 'saas_support']) })),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const t = TEMPLATES[(req.body as { template: string }).template];
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, req.params.id))
      .limit(1);
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');

    const [config] = await db
      .select()
      .from(assistantConfigurations)
      .where(eq(assistantConfigurations.organizationId, org.id))
      .limit(1);
    const patch = {
      welcomeMessage: t.welcomeMessage,
      intakeFields: JSON.stringify(t.intakeFields),
      guardrails: JSON.stringify(t.guardrails),
    };
    if (config) {
      await db
        .update(assistantConfigurations)
        .set(patch)
        .where(eq(assistantConfigurations.organizationId, org.id));
    } else {
      await db.insert(assistantConfigurations).values({ organizationId: org.id, ...patch });
    }
    for (const faq of t.faqs) {
      await db.insert(knowledgeItems).values({
        organizationId: org.id,
        title: faq.title,
        content: faq.content,
        category: 'FAQ',
        status: 'ACTIVE',
        sourceType: 'TEXT',
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
    }
    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: 'admin.template.applied',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { template: (req.body as { template: string }).template },
    });
    res.json({ applied: (req.body as { template: string }).template, faqsCreated: t.faqs.length });
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
      .select({
        id: auditEvents.id,
        organizationId: auditEvents.organizationId,
        actorUserId: auditEvents.actorUserId,
        actorName: users.name,
        actorEmail: users.email,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.actorUserId, users.id))
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

// ---------------------------------------------------------------------------
// Client detail: a full view of one organization — record, business settings,
// assistant configuration, products, subscriptions, team and usage.
// ---------------------------------------------------------------------------
async function requireOrg(id: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organization not found');
  return org;
}

router.get(
  '/organizations/:id/overview',
  handle(async (req, res) => {
    requirePlatformManage(req);
    const org = await requireOrg(req.params.id);

    const [settingsRow, configRow, productRows, subRows, userRows, usageByEvent] =
      await Promise.all([
        db
          .select()
          .from(organizationSettings)
          .where(eq(organizationSettings.organizationId, org.id))
          .limit(1),
        db
          .select()
          .from(assistantConfigurations)
          .where(eq(assistantConfigurations.organizationId, org.id))
          .limit(1),
        db
          .select({
            status: organizationProducts.status,
            productId: products.id,
            code: products.code,
            name: products.name,
          })
          .from(organizationProducts)
          .innerJoin(products, eq(organizationProducts.productId, products.id))
          .where(eq(organizationProducts.organizationId, org.id)),
        db
          .select({
            id: subscriptions.id,
            productCode: products.code,
            productName: products.name,
            status: subscriptions.status,
            startAt: subscriptions.startAt,
            endAt: subscriptions.endAt,
            createdAt: subscriptions.createdAt,
          })
          .from(subscriptions)
          .leftJoin(products, eq(subscriptions.productId, products.id))
          .where(eq(subscriptions.organizationId, org.id))
          .orderBy(desc(subscriptions.createdAt)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            status: users.status,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.organizationId, org.id)),
        db
          .select({
            eventType: usageRecords.eventType,
            quantity: sql<number>`coalesce(sum(${usageRecords.quantity}),0)`,
          })
          .from(usageRecords)
          .where(eq(usageRecords.organizationId, org.id))
          .groupBy(usageRecords.eventType),
      ]);

    res.json({
      organization: org,
      settings: presentSettings(settingsRow[0]),
      assistConfig: mapConfig(configRow[0]),
      products: productRows,
      subscriptions: subRows,
      users: userRows,
      usageByEvent: usageByEvent.map((r) => ({
        eventType: r.eventType,
        quantity: Number(r.quantity),
      })),
    });
  })
);

router.patch(
  '/organizations/:id/settings',
  validate(updateSettingsSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const org = await requireOrg(req.params.id);
    const updates = req.body as Record<string, unknown>;

    const existing = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, org.id))
      .limit(1);
    let row;
    if (existing.length === 0) {
      [row] = await db
        .insert(organizationSettings)
        .values({ organizationId: org.id, ...updates })
        .returning();
    } else {
      [row] = await db
        .update(organizationSettings)
        .set(updates)
        .where(eq(organizationSettings.organizationId, org.id))
        .returning();
    }
    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: 'organization.settings.updated',
      resourceType: 'organization_settings',
      resourceId: org.id,
      metadata: { fields: Object.keys(updates), via: 'platform_admin' },
    });
    res.json(presentSettings(row));
  })
);

router.patch(
  '/organizations/:id/assist-config',
  validate(updateAssistSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const org = await requireOrg(req.params.id);
    const updates = { ...(req.body as Record<string, unknown>) };
    if (Array.isArray(updates.allowedOrigins)) {
      updates.allowedOrigins = JSON.stringify([...new Set(updates.allowedOrigins as string[])]);
    }

    const existing = await db
      .select()
      .from(assistantConfigurations)
      .where(eq(assistantConfigurations.organizationId, org.id))
      .limit(1);
    let row;
    if (existing.length === 0) {
      [row] = await db
        .insert(assistantConfigurations)
        .values({ organizationId: org.id, ...updates })
        .returning();
    } else {
      [row] = await db
        .update(assistantConfigurations)
        .set(updates)
        .where(eq(assistantConfigurations.organizationId, org.id))
        .returning();
    }
    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: 'assist.config.updated',
      resourceType: 'assistant_configurations',
      resourceId: org.id,
      metadata: { fields: Object.keys(updates), via: 'platform_admin' },
    });
    res.json(mapConfig(row));
  })
);

// Per-organization usage detail: totals by event type plus the raw recent
// records. Powers the expandable rows on the admin usage page.
router.get(
  '/organizations/:id/usage',
  handle(async (req, res) => {
    requirePlatformManage(req);
    const org = await requireOrg(req.params.id);

    const [totals, recent] = await Promise.all([
      db
        .select({
          eventType: usageRecords.eventType,
          quantity: sql<number>`coalesce(sum(${usageRecords.quantity}),0)`,
        })
        .from(usageRecords)
        .where(eq(usageRecords.organizationId, org.id))
        .groupBy(usageRecords.eventType),
      db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.organizationId, org.id))
        .orderBy(desc(usageRecords.createdAt))
        .limit(50),
    ]);

    res.json({
      totals: totals.map((r) => ({ eventType: r.eventType, quantity: Number(r.quantity) })),
      recent: recent.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        quantity: r.quantity,
        provider: r.provider,
        createdAt: r.createdAt,
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// Client registration: create the organization, an administrator account for
// the contact person, and email them a link to set their password.
// ---------------------------------------------------------------------------
const registerClientSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contactName: z.string().trim().min(1).max(255),
  contactEmail: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((e) => e.toLowerCase()),
  productCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(10).default([]),
});

const INVITE_TTL_MINUTES = 7 * 24 * 60;

async function uniqueSlug(base: string) {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!cleaned) throw new ApiError(400, 'VALIDATION_ERROR', 'Name has no usable letters');
  let slug = cleaned;
  for (let i = 2; i <= 20; i++) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (!existing) return slug;
    slug = `${cleaned}-${i}`;
  }
  throw new ApiError(409, 'ORG_EXISTS', 'Could not derive a unique slug for this name');
}

router.post(
  '/organizations/register',
  validate(registerClientSchema),
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const body = req.body as z.infer<typeof registerClientSchema>;

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.contactEmail))
      .limit(1);
    if (existingUser) {
      throw new ApiError(
        409,
        'EMAIL_EXISTS',
        'That email already has an account — add them to the organization instead'
      );
    }

    const slug = await uniqueSlug(body.name);
    const [adminRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, 'Client Administrator'))
      .limit(1);
    const selectedProducts = body.productCodes.length
      ? await db.select().from(products).where(inArray(products.code, body.productCodes))
      : [];

    const { org, user } = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: body.name, slug, status: 'active', publicKey: newPublicKey() })
        .returning();
      // Placeholder hash — the invitee sets a real password via the invite link.
      const passwordHash = await hashPassword(randomBytes(24).toString('hex'));
      const [user] = await tx
        .insert(users)
        .values({
          email: body.contactEmail,
          name: body.contactName,
          passwordHash,
          status: 'active',
          organizationId: org.id,
        })
        .returning();
      if (adminRole) {
        await tx
          .insert(userRoles)
          .values({ userId: user.id, roleId: adminRole.id, organizationId: org.id });
      }
      for (const p of selectedProducts) {
        await tx.insert(organizationProducts).values({
          organizationId: org.id,
          productId: p.id,
          status: 'active',
        });
        await tx.insert(subscriptions).values({
          organizationId: org.id,
          productId: p.id,
          status: 'trialing',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
      }
      return { org, user };
    });

    const token = await createPasswordResetToken(user.id, INVITE_TTL_MINUTES);
    const inviteUrl = `${env.APP_BASE_URL}/reset-password?token=${token}`;
    let inviteSent = true;
    try {
      await getMailTransport().send({
        to: user.email,
        subject: `You're invited to WymNet AI — set up ${body.name}`,
        text: `Hi ${user.name},\n\nAn account for "${body.name}" has been created on WymNet AI and you are the administrator. Set your password to get started — this link works once and expires in 7 days.\n\n${inviteUrl}\n\nIf you weren't expecting this, you can ignore this email.`,
        html: `<p>Hi ${user.name},</p><p>An account for <strong>${body.name}</strong> has been created on WymNet AI and you are the administrator. Set your password to get started — this link works once and expires in 7 days.</p><p><a href="${inviteUrl}">Set your password</a></p><p>If you weren't expecting this, you can ignore this email.</p>`,
      });
    } catch (err) {
      inviteSent = false;
      console.error(
        `[admin] invite email to ${user.email} failed:`,
        err instanceof Error ? err.message : err
      );
    }

    await recordAudit({
      organizationId: org.id,
      actorUserId: auth.userId,
      action: 'organization.registered',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: {
        contactEmail: body.contactEmail,
        contactName: body.contactName,
        productCodes: body.productCodes,
        inviteSent,
        via: 'platform_admin',
      },
    });

    res.status(201).json({ organization: org, invitedEmail: user.email, inviteSent });
  })
);

// ---------------------------------------------------------------------------
// Client deletion: removes the organization and every row that belongs to it.
// Platform audit keeps a tombstone (org-less event) after the cascade.
// ---------------------------------------------------------------------------
router.delete(
  '/organizations/:id',
  handle(async (req, res) => {
    const auth = requirePlatformManage(req);
    const org = await requireOrg(req.params.id);

    await db.transaction(async (tx) => {
      const orgUserIds = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.organizationId, org.id))
      ).map((r) => r.id);
      const orgKnowledgeItemIds = tx
        .select({ id: knowledgeItems.id })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.organizationId, org.id));

      // Leaf tables first — children before their parents.
      await tx.delete(flowTasks).where(eq(flowTasks.organizationId, org.id));
      await tx.delete(flowActivities).where(eq(flowActivities.organizationId, org.id));
      await tx.delete(flowInstances).where(eq(flowInstances.organizationId, org.id));
      await tx.delete(flowDefinitions).where(eq(flowDefinitions.organizationId, org.id));
      await tx.delete(insightReports).where(eq(insightReports.organizationId, org.id));
      await tx.delete(datasets).where(eq(datasets.organizationId, org.id));
      await tx.delete(handoffNotes).where(eq(handoffNotes.organizationId, org.id));
      await tx.delete(handoffs).where(eq(handoffs.organizationId, org.id));
      await tx.delete(leadNotes).where(eq(leadNotes.organizationId, org.id));
      await tx.delete(leads).where(eq(leads.organizationId, org.id));
      await tx.delete(appointments).where(eq(appointments.organizationId, org.id));
      await tx.delete(chatSessions).where(eq(chatSessions.organizationId, org.id));
      await tx.delete(messages).where(eq(messages.organizationId, org.id));
      await tx.delete(conversations).where(eq(conversations.organizationId, org.id));
      await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.organizationId, org.id));
      await tx
        .delete(knowledgeDocuments)
        .where(inArray(knowledgeDocuments.knowledgeItemId, orgKnowledgeItemIds));
      await tx.delete(knowledgeItems).where(eq(knowledgeItems.organizationId, org.id));
      await tx.delete(notifications).where(eq(notifications.organizationId, org.id));
      await tx.delete(reportSchedules).where(eq(reportSchedules.organizationId, org.id));
      await tx.delete(subscriptions).where(eq(subscriptions.organizationId, org.id));
      await tx
        .delete(organizationProducts)
        .where(eq(organizationProducts.organizationId, org.id));
      await tx
        .delete(organizationSettings)
        .where(eq(organizationSettings.organizationId, org.id));
      await tx
        .delete(assistantConfigurations)
        .where(eq(assistantConfigurations.organizationId, org.id));
      await tx.delete(usageRecords).where(eq(usageRecords.organizationId, org.id));
      await tx.delete(auditEvents).where(eq(auditEvents.organizationId, org.id));
      if (orgUserIds.length) {
        await tx.delete(userPreferences).where(inArray(userPreferences.userId, orgUserIds));
        await tx
          .delete(passwordResetTokens)
          .where(inArray(passwordResetTokens.userId, orgUserIds));
        await tx.delete(refreshTokens).where(inArray(refreshTokens.userId, orgUserIds));
        await tx
          .delete(userRoles)
          .where(
            or(eq(userRoles.organizationId, org.id), inArray(userRoles.userId, orgUserIds))
          );
      } else {
        await tx.delete(userRoles).where(eq(userRoles.organizationId, org.id));
      }
      await tx.delete(users).where(eq(users.organizationId, org.id));
      await tx.delete(organizations).where(eq(organizations.id, org.id));
    });

    await recordAudit({
      organizationId: null,
      actorUserId: auth.userId,
      action: 'organization.deleted',
      resourceType: 'organization',
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug, via: 'platform_admin' },
    });
    res.status(204).send();
  })
);

export default router;

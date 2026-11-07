import { db } from '../../database/client';
import {
  organizationProducts,
  plans,
  products,
  subscriptions,
} from '../../database/schema/core';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { ApiError } from '../../middleware/error';

type DbOrTx = typeof db;

export const TRIAL_DAYS = 3;
const TRIAL_PLAN_CODE = 'TRIAL';

// The free trial is deliberately tiny — enough to evaluate, not to run on.
const TRIAL_LIMITS = {
  maxSeats: 2,
  maxKnowledgeItems: 10,
  maxMonthlyConversations: 20,
  maxMonthlyAiMessages: 50,
};

/** Finds or creates the shared trial plan all self-serve signups get. */
export async function ensureTrialPlan() {
  const [existing] = await db
    .select()
    .from(plans)
    .where(eq(plans.code, TRIAL_PLAN_CODE))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(plans)
    .values({
      code: TRIAL_PLAN_CODE,
      name: 'Free trial',
      monthlyPriceCents: 0,
      ...TRIAL_LIMITS,
    })
    .onConflictDoNothing({ target: plans.code })
    .returning();
  if (created) return created;
  const [row] = await db.select().from(plans).where(eq(plans.code, TRIAL_PLAN_CODE)).limit(1);
  return row;
}

/** Flips lapsed trials to expired. Called lazily wherever access is checked. */
export async function syncTrialExpiry(organizationId: string) {
  await db
    .update(subscriptions)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(subscriptions.status, 'trialing'),
        lt(subscriptions.trialEndsAt, new Date())
      )
    );
}

export async function organizationHasProduct(organizationId: string, productCode: string) {
  await syncTrialExpiry(organizationId);
  const rows = await db
    .select({})
    .from(organizationProducts)
    .innerJoin(products, eq(organizationProducts.productId, products.id))
    .where(
      and(
        eq(organizationProducts.organizationId, organizationId),
        eq(products.code, productCode),
        eq(products.active, true),
        eq(organizationProducts.status, 'active')
      )
    )
    .limit(1);
  if (!rows.length) return false;

  // When the org has billing records for this product, one must still be
  // live — an expired trial no longer unlocks the product. Orgs granted
  // products directly (no subscriptions) keep their access.
  const subs = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        eq(products.code, productCode)
      )
    );
  if (!subs.length) return true;
  return subs.some((s) => s.status === 'trialing' || s.status === 'active');
}

/** The plan attached to the org's current subscription, if any. */
export async function getCurrentPlan(organizationId: string) {
  const [row] = await db
    .select({ plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        inArray(subscriptions.status, ['trialing', 'active'])
      )
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row?.plan ?? null;
}

type PlanLimitField =
  | 'maxSeats'
  | 'maxKnowledgeItems'
  | 'maxMonthlyConversations'
  | 'maxMonthlyAiMessages';

/** Throws PLAN_LIMIT_REACHED when the org's plan caps `field` at `current`. */
export async function enforcePlanLimit(
  organizationId: string,
  field: PlanLimitField,
  current: number,
  label: string
) {
  const plan = await getCurrentPlan(organizationId);
  const max = plan?.[field];
  if (max == null || current < max) return;
  throw new ApiError(
    403,
    'PLAN_LIMIT_REACHED',
    `Your ${plan?.name ?? 'plan'} includes up to ${max} ${label} — upgrade to keep going.`
  );
}

/** True while the org only has a trial — no active/paid subscription yet. */
export async function isTrialOnly(organizationId: string) {
  await syncTrialExpiry(organizationId);
  const rows = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));
  if (!rows.length) return false;
  return !rows.some((r) => r.status === 'active');
}

/** Grants every active product to a new org for the trial window. Call inside
 *  the same transaction that creates the org so signup is atomic. */
export async function grantFreeTrial(tx: DbOrTx, organizationId: string) {
  const plan = await ensureTrialPlan();
  const allProducts = await tx.select().from(products).where(eq(products.active, true));
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  for (const p of allProducts) {
    await tx
      .insert(organizationProducts)
      .values({ organizationId, productId: p.id, status: 'active' })
      .onConflictDoNothing({
        target: [organizationProducts.organizationId, organizationProducts.productId],
      });
    await tx.insert(subscriptions).values({
      organizationId,
      productId: p.id,
      planId: plan.id,
      status: 'trialing',
      trialEndsAt,
    });
  }
  return trialEndsAt;
}

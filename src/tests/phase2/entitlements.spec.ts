import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../database/client';
import { organizations, products, organizationProducts } from '../../database/schema/core';
import { organizationHasProduct } from '../../modules/products/service';
import { eq } from 'drizzle-orm';

async function ensureOrg(name: string, slug: string) {
  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (existing.length) return existing[0];
  const [o] = await db.insert(organizations).values({ name, slug, status: 'active' }).returning();
  return o;
}

async function ensureProduct(code: string, name: string) {
  const existing = await db.select().from(products).where(eq(products.code, code)).limit(1);
  if (existing.length) return existing[0];
  const [p] = await db.insert(products).values({ code, name, active: true }).returning();
  return p;
}

describe('Organization product entitlements', () => {
  let orgA: any;
  let orgB: any;
  let prodAssist: any;

  beforeAll(async () => {
    orgA = await ensureOrg('Entitlement Org A', 'entitlement-org-a');
    orgB = await ensureOrg('Entitlement Org B', 'entitlement-org-b');
    prodAssist = await ensureProduct('WYMASSIST', 'WymAssist AI');

    // Clean slate: remove any prior entitlements for these test orgs
    await db.delete(organizationProducts).where(eq(organizationProducts.organizationId, orgA.id));
    await db.delete(organizationProducts).where(eq(organizationProducts.organizationId, orgB.id));
  });

  it('returns true when assigned active', async () => {
    await db
      .insert(organizationProducts)
      .values({ organizationId: orgA.id, productId: prodAssist.id, status: 'active' });
    const ok = await organizationHasProduct(orgA.id, 'WYMASSIST');
    expect(ok).toBe(true);
  });

  it('returns false when unassigned', async () => {
    const ok = await organizationHasProduct(orgB.id, 'WYMASSIST');
    expect(ok).toBe(false);
  });

  it('returns false when assignment is inactive', async () => {
    // flip to inactive explicitly
    await db
      .update(organizationProducts)
      .set({ status: 'inactive' })
      .where(eq(organizationProducts.organizationId, orgA.id));
    const ok = await organizationHasProduct(orgA.id, 'WYMASSIST');
    expect(ok).toBe(false);
  });

  it('returns false when product inactive', async () => {
    await db.update(products).set({ active: false }).where(eq(products.id, prodAssist.id));
    const ok = await organizationHasProduct(orgA.id, 'WYMASSIST');
    expect(ok).toBe(false);
    await db.update(products).set({ active: true }).where(eq(products.id, prodAssist.id));
  });
});

import { Request, Response } from 'express';
import { db } from '../../database/client';
import {
  organizationProducts,
  organizations,
  products,
  subscriptions,
} from '../../database/schema/core';
import { desc, eq } from 'drizzle-orm';
import { recordAudit } from '../audit/service';
import { requirePermission, requirePlatform, requireOrgScope } from '../rbac/authz';
import { newPublicKey } from '../../lib/keys';

export async function listOrganizations(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'organization.read');
  if (!auth.platformAccess) {
    // client users can only see their org
    if (!auth.organizationId) return res.json([]);
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId));
    return res.json(rows);
  }
  const rows = await db.select().from(organizations);
  return res.json(rows);
}

export async function getOrganization(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'organization.read');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org)
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
  return res.json(org);
}

export async function listOrganizationProducts(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'organization.read');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const rows = await db
    .select({
      status: organizationProducts.status,
      productId: products.id,
      code: products.code,
      name: products.name,
      description: products.description,
      active: products.active,
    })
    .from(organizationProducts)
    .innerJoin(products, eq(organizationProducts.productId, products.id))
    .where(eq(organizationProducts.organizationId, id));
  return res.json(rows);
}

export async function createOrganization(req: Request, res: Response) {
  const auth = req.auth;
  requirePlatform(auth);
  requirePermission(auth, 'organization.create');
  const body = req.body as {
    name: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'archived';
  };
  const [org] = await db
    .insert(organizations)
    .values({ name: body.name, slug: body.slug, status: body.status, publicKey: newPublicKey() })
    .returning();
  return res.status(201).json(org);
}

// Rotates the public widget key — invalidates every embed snippet using the old
// one. Available to org admins and platform operators.
export async function rotateWidgetKey(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'organization.update');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const [org] = await db
    .update(organizations)
    .set({ publicKey: newPublicKey(), updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  if (!org)
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
  await recordAudit({
    organizationId: org.id,
    actorUserId: auth.userId,
    action: 'organization.widget_key_rotated',
    resourceType: 'organization',
    resourceId: org.id,
  });
  return res.json({ id: org.id, publicKey: org.publicKey });
}

export async function updateOrganization(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'organization.update');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const body = req.body as Partial<{
    name: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'archived';
  }>;
  // Lifecycle status is a platform control — a suspended client must not be
  // able to re-activate (or suspend) itself.
  if (body.status && body.status !== undefined && !auth.platformAccess) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Organization status is managed by the platform' },
    });
  }
  const updates: Partial<{
    name: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'archived';
  }> = {};
  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.slug === 'string') updates.slug = body.slug;
  if (body.status) updates.status = body.status;
  const [org] = await db
    .update(organizations)
    .set(updates)
    .where(eq(organizations.id, id))
    .returning();
  if (!org)
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
  await recordAudit({
    organizationId: id,
    actorUserId: auth.userId,
    action: 'organization.updated',
    resourceType: 'organization',
    resourceId: id,
    metadata: { fields: Object.keys(updates) },
  });
  return res.json(org);
}

export async function listOrganizationSubscriptions(req: Request, res: Response) {
  const auth = req.auth;
  requirePermission(auth, 'subscription.read');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const rows = await db
    .select({
      id: subscriptions.id,
      organizationId: subscriptions.organizationId,
      productCode: products.code,
      productName: products.name,
      status: subscriptions.status,
      startAt: subscriptions.startAt,
      endAt: subscriptions.endAt,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.organizationId, id))
    .orderBy(desc(subscriptions.createdAt));
  return res.json(rows);
}

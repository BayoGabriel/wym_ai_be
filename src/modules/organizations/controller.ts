import { Request, Response } from 'express';
import { db } from '../../database/client';
import { organizationProducts, organizations, products } from '../../database/schema/core';
import { and, eq } from 'drizzle-orm';
import { requirePermission, requirePlatform, requireOrgScope } from '../rbac/authz';

export async function listOrganizations(req: Request, res: Response) {
  const auth = (req as any).auth;
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
  const auth = (req as any).auth;
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
  const auth = (req as any).auth;
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
  const auth = (req as any).auth;
  requirePlatform(auth);
  requirePermission(auth, 'organization.create');
  const body = req.body as {
    name: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'archived';
  };
  const [org] = await db
    .insert(organizations)
    .values({ name: body.name, slug: body.slug, status: body.status })
    .returning();
  return res.status(201).json(org);
}

export async function updateOrganization(req: Request, res: Response) {
  const auth = (req as any).auth;
  requirePermission(auth, 'organization.update');
  const { id } = req.params as { id: string };
  if (!auth.platformAccess) requireOrgScope(auth, id);
  const body = req.body as Partial<{
    name: string;
    slug: string;
    status: 'pending' | 'active' | 'suspended' | 'archived';
  }>;
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
    .set(updates as any)
    .where(eq(organizations.id, id))
    .returning();
  if (!org)
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
  return res.json(org);
}

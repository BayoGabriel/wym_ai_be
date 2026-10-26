import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  organizationProducts,
  organizations,
  permissions,
  products,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../../database/schema/core';
import { hashPassword } from '../../modules/auth/service';

export async function ensureOrg(name: string, slug: string) {
  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (existing.length) return existing[0];
  const [row] = await db.insert(organizations).values({ name, slug, status: 'active' }).returning();
  return row;
}

export async function ensureUser(email: string, organizationId: string | null) {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) return existing[0];
  const passwordHash = await hashPassword('Passw0rd!');
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: email.split('@')[0],
      passwordHash,
      status: 'active',
      organizationId,
    })
    .returning();
  return row;
}

export async function ensurePermission(name: string) {
  const existing = await db.select().from(permissions).where(eq(permissions.name, name)).limit(1);
  if (existing.length) return existing[0];
  const [row] = await db.insert(permissions).values({ name }).returning();
  return row;
}

export async function ensureRole(name: string, scope: 'platform' | 'organization') {
  const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing.length) return existing[0];
  const [row] = await db.insert(roles).values({ name, scope }).returning();
  return row;
}

export async function grantRolePermission(roleId: string, permissionName: string) {
  const permission = await ensurePermission(permissionName);
  await db
    .insert(rolePermissions)
    .values({ roleId, permissionId: permission.id })
    .onConflictDoNothing?.();
}

export async function assignUserRole(params: {
  userId: string;
  roleId: string;
  organizationId?: string | null;
}) {
  await db
    .insert(userRoles)
    .values({
      userId: params.userId,
      roleId: params.roleId,
      organizationId: params.organizationId ?? null,
    })
    .onConflictDoNothing?.();
}

export async function ensureAssistProduct() {
  const existing = await db.select().from(products).where(eq(products.code, 'WYMASSIST')).limit(1);
  if (existing.length) return existing[0];
  const [row] = await db
    .insert(products)
    .values({
      name: 'WymAssist AI',
      code: 'WYMASSIST',
      description: 'Assistant product',
      active: true,
    })
    .returning();
  return row;
}

export async function setAssistEntitlement(params: {
  organizationId: string;
  status: 'active' | 'inactive';
}) {
  const product = await ensureAssistProduct();
  const existing = await db
    .select()
    .from(organizationProducts)
    .where(
      and(
        eq(organizationProducts.organizationId, params.organizationId),
        eq(organizationProducts.productId, product.id)
      )
    )
    .limit(1);
  if (!existing.length) {
    await db.insert(organizationProducts).values({
      organizationId: params.organizationId,
      productId: product.id,
      status: params.status,
    });
    return;
  }
  await db
    .update(organizationProducts)
    .set({ status: params.status })
    .where(
      and(
        eq(organizationProducts.organizationId, params.organizationId),
        eq(organizationProducts.productId, product.id)
      )
    );
}

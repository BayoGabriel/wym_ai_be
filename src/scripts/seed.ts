import 'dotenv/config';
import { db } from '../database/client';
import { roles, permissions, products, rolePermissions } from '../database/schema/core';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '../modules/rbac/permissions';

async function ensurePermission(name: string) {
  const existing = await db.select().from(permissions).where(eq(permissions.name, name)).limit(1);
  if (existing.length === 0) {
    await db.insert(permissions).values({ name });
  }
}

async function ensureRole(name: string, scope: 'platform' | 'organization') {
  const existing = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (existing.length === 0) {
    await db.insert(roles).values({ name, scope });
  }
}

async function idForRole(name: string) {
  const [r] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  return r?.id as string;
}

async function idForPermission(name: string) {
  const [p] = await db.select().from(permissions).where(eq(permissions.name, name)).limit(1);
  return p?.id as string;
}

async function grant(roleName: string, permissionName: string) {
  const roleId = await idForRole(roleName);
  const permissionId = await idForPermission(permissionName);
  if (!roleId || !permissionId) return;
  const existing = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId))
    .limit(1);
  // naive insert; duplicates are fine to ignore for seed simplicity
  await db.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing?.();
}

async function ensureProduct(code: string, name: string, description?: string) {
  const existing = await db.select().from(products).where(eq(products.code, code)).limit(1);
  if (existing.length === 0) {
    await db.insert(products).values({ code, name, description });
  }
}

async function main() {
  // Permissions
  for (const key of Object.keys(PERMISSIONS)) {
    await ensurePermission(PERMISSIONS[key as keyof typeof PERMISSIONS]);
  }

  // Roles
  await ensureRole('WymNet Super Administrator', 'platform');
  await ensureRole('WymNet Administrator', 'platform');
  await ensureRole('Client Administrator', 'organization');
  await ensureRole('Client Staff', 'organization');

  // Products
  await ensureProduct('WYMASSIST', 'WymAssist AI', 'Customer-facing assistant product');
  await ensureProduct('WYMINSIGHT', 'WymInsight AI', 'Insights and analytics product');
  await ensureProduct('WYMFLOW', 'WymFlow AI', 'Workflow and automation product');

  // Role-permission seeds (sample, can be expanded)
  const platformWide = [
    'platform.manage',
    'organization.read',
    'organization.create',
    'organization.update',
    'user.read',
    'user.create',
    'user.update',
    'role.read',
    'permission.read',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
  ];
  for (const perm of platformWide) await grant('WymNet Super Administrator', perm);

  const platformAdmin = [
    'organization.read',
    'organization.create',
    'organization.update',
    'user.read',
    'user.create',
    'user.update',
    'role.read',
    'permission.read',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
  ];
  for (const perm of platformAdmin) await grant('WymNet Administrator', perm);

  const clientAdmin = [
    'organization.read',
    'user.read',
    'user.create',
    'user.update',
    'conversation.read',
    'conversation.create',
    'conversation.update',
    'conversation.message.create',
    'lead.read',
    'lead.write',
    'handoff.read',
    'handoff.write',
    'handoff.assign',
    'knowledge.read',
    'knowledge.write',
    'appointment.read',
    'report.read',
  ];
  for (const perm of clientAdmin) await grant('Client Administrator', perm);

  const clientStaff = [
    'organization.read',
    'conversation.read',
    'conversation.create',
    'conversation.message.create',
    'lead.read',
    'lead.write',
    'handoff.read',
    'handoff.write',
    'knowledge.read',
    'appointment.read',
  ];
  for (const perm of clientStaff) await grant('Client Staff', perm);

  // eslint-disable-next-line no-console
  console.log('Seed completed');
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

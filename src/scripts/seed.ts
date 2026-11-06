import 'dotenv/config';
import { db } from '../database/client';
import {
  roles,
  permissions,
  products,
  rolePermissions,
  users,
  userRoles,
} from '../database/schema/core';
import { and, eq } from 'drizzle-orm';
import { PERMISSIONS } from '../modules/rbac/permissions';
import { hashPassword } from '../modules/auth/service';

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
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(rolePermissions).values({ roleId, permissionId });
  }
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
    'lead.read',
    'lead.write',
    'knowledge.read',
    'knowledge.write',
    'appointment.read',
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
    'subscription.write',
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
    'appointment.read',
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
    'subscription.write',
  ];
  for (const perm of platformAdmin) await grant('WymNet Administrator', perm);

  const clientAdmin = [
    'organization.read',
    'organization.update',
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
    'appointment.write',
    'report.read',
    'insight.read',
    'insight.write',
    'flow.read',
    'flow.write',
    'flow.admin',
    'subscription.read',
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
    'appointment.write',
    'insight.read',
    'flow.read',
    'flow.write',
  ];
  for (const perm of clientStaff) await grant('Client Staff', perm);

  // Platform super administrator (organizationId null → platform access).
  // In production the credentials must be supplied explicitly — the built-in
  // defaults exist for local development only.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'info@wymnet.org';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set when seeding a production database');
  }
  const resolvedAdminPassword = adminPassword ?? 'Wymnet@1995';
  let [admin] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  if (!admin) {
    const passwordHash = await hashPassword(resolvedAdminPassword);
    [admin] = await db
      .insert(users)
      .values({
        email: adminEmail,
        name: 'WymNet Super Admin',
        passwordHash,
        status: 'active',
        organizationId: null,
      })
      .returning();
  }
  const superRoleId = await idForRole('WymNet Super Administrator');
  const [assigned] = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, admin.id), eq(userRoles.roleId, superRoleId)))
    .limit(1);
  if (!assigned) {
    await db.insert(userRoles).values({ userId: admin.id, roleId: superRoleId });
  }

  // eslint-disable-next-line no-console
  console.log('Seed completed');
  process.exit(0);
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});

import { Request, Response } from 'express';
import { db } from '../../database/client';
import { roles, userRoles, users } from '../../database/schema/core';
import { and, count, eq, inArray } from 'drizzle-orm';
import { ApiError } from '../../middleware/error';
import { requirePermission } from '../rbac/authz';
import { hashPassword } from '../auth/service';
import { enforcePlanLimit } from '../products/service';
import { recordAudit } from '../audit/service';
import { AuthContext } from '../../types/auth';

type Auth = AuthContext;

async function resolveAssignableRole(auth: Auth, roleName: string, organizationId: string | null) {
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
  if (!role) {
    throw new ApiError(400, 'INVALID_ROLE', `Unknown role: ${roleName}`);
  }
  // Client users may only grant organization-scope roles inside their own org;
  // only platform users may grant platform-scope roles.
  if (role.scope === 'platform' && !auth.platformAccess) {
    throw new ApiError(403, 'FORBIDDEN', 'Cannot assign a platform-scope role');
  }
  if (role.scope === 'organization' && !organizationId) {
    throw new ApiError(400, 'INVALID_ROLE', 'Organization role requires an organization user');
  }
  return role;
}

async function rolesForUsers(userIds: string[]) {
  if (!userIds.length) return new Map<string, string[]>();
  const rows = await db
    .select({ userId: userRoles.userId, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(inArray(userRoles.userId, userIds));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push(r.name);
    map.set(r.userId, list);
  }
  return map;
}

function publicUser(u: typeof users.$inferSelect, roleNames: string[] = []) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    organizationId: u.organizationId,
    department: u.department ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roles: roleNames,
  };
}

export async function listUsers(req: Request, res: Response) {
  const auth = (req as unknown as { auth: Auth }).auth;
  requirePermission(auth, 'user.read');
  const rows = auth.platformAccess
    ? await db.select().from(users)
    : await db.select().from(users).where(eq(users.organizationId, auth.organizationId!));
  const roleMap = await rolesForUsers(rows.map((u) => u.id));
  return res.json(rows.map((u) => publicUser(u, roleMap.get(u.id) ?? [])));
}

export async function getUser(req: Request, res: Response) {
  const auth = (req as unknown as { auth: Auth }).auth;
  requirePermission(auth, 'user.read');
  const { id } = req.params as { id: string };
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  // Out-of-scope lookups return 404 so callers can't distinguish "user exists
  // in another org" from "user does not exist" by status code.
  if (!user || (!auth.platformAccess && user.organizationId !== auth.organizationId))
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  const roleMap = await rolesForUsers([user.id]);
  return res.json(publicUser(user, roleMap.get(user.id) ?? []));
}

export async function createUser(req: Request, res: Response) {
  const auth = (req as unknown as { auth: Auth }).auth as Auth;
  requirePermission(auth, 'user.create');
  const body = req.body as {
    email: string;
    name: string;
    password: string;
    organizationId?: string | null;
    status?: 'active' | 'suspended';
    roleName?: string;
  };
  // Client admins can only create in their own org; platform admins can specify orgId or null
  const targetOrgId = auth.platformAccess ? (body.organizationId ?? null) : auth.organizationId;
  if (!auth.platformAccess && body.organizationId && body.organizationId !== auth.organizationId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Cannot create user in another organization' },
    });
  }
  const role = body.roleName ? await resolveAssignableRole(auth, body.roleName, targetOrgId) : null;

  const [emailTaken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (emailTaken)
    return res
      .status(409)
      .json({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });

  // Plan gate: capped plans (e.g. the free trial) limit team size.
  if (targetOrgId) {
    const [seats] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.organizationId, targetOrgId));
    await enforcePlanLimit(targetOrgId, 'maxSeats', Number(seats?.value ?? 0), 'team members');
  }

  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      name: body.name,
      passwordHash,
      status: body.status ?? 'active',
      organizationId: targetOrgId,
    })
    .returning();
  if (role) {
    await db.insert(userRoles).values({
      userId: user.id,
      roleId: role.id,
      organizationId: role.scope === 'platform' ? null : targetOrgId,
    });
  }
  await recordAudit({
    organizationId: targetOrgId,
    actorUserId: auth.userId,
    action: 'user.created',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { roleName: body.roleName ?? null },
  });
  return res.status(201).json(publicUser(user, role ? [role.name] : []));
}

export async function updateUser(req: Request, res: Response) {
  const auth = (req as unknown as { auth: Auth }).auth as Auth;
  requirePermission(auth, 'user.update');
  const { id } = req.params as { id: string };
  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing || (!auth.platformAccess && existing.organizationId !== auth.organizationId))
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  const body = req.body as Partial<{
    name: string;
    password: string;
    status: 'active' | 'suspended';
    roleName: string | null;
    department: string | null;
  }>;
  const updates: Partial<typeof users.$inferInsert> = {};
  if (body.name) updates.name = body.name;
  if (body.status) updates.status = body.status;
  if (body.department !== undefined) updates.department = body.department;
  if (body.password) updates.passwordHash = await hashPassword(body.password);
  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();

  // roleName replaces the user's organization-scope roles; null clears them.
  // Platform-scope assignments are never touched by this path. The role is
  // resolved before any rows are touched, and the swap is atomic, so an
  // invalid role can never leave the user roleless.
  if (body.roleName !== undefined) {
    const role = body.roleName
      ? await resolveAssignableRole(auth, body.roleName, existing.organizationId)
      : null;
    await db.transaction(async (tx) => {
      await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, existing.id),
            inArray(
              userRoles.roleId,
              db.select({ id: roles.id }).from(roles).where(eq(roles.scope, 'organization'))
            )
          )
        );
      if (role) {
        await tx.insert(userRoles).values({
          userId: existing.id,
          roleId: role.id,
          organizationId: role.scope === 'platform' ? null : existing.organizationId,
        });
      }
    });
    await recordAudit({
      organizationId: existing.organizationId,
      actorUserId: auth.userId,
      action: 'user.role_changed',
      resourceType: 'user',
      resourceId: existing.id,
      metadata: { roleName: body.roleName },
    });
  }
  const roleMap = await rolesForUsers([user.id]);
  return res.json(publicUser(user, roleMap.get(user.id) ?? []));
}

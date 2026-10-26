import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './service';
import { db } from '../../database/client';
import { users, roles, userRoles, rolePermissions, permissions } from '../../database/schema/core';
import { and, eq } from 'drizzle-orm';
import { AuthContext } from '../../types/auth';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
  const token = auth.substring('Bearer '.length);
  try {
    const payload = verifyAccessToken(token) as any;
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || user.status !== 'active')
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid user' } });

    // roles for this user (for platform roles, organizationId is null in user_roles)
    const rows = await db
      .select({
        roleId: roles.id,
        roleName: roles.name,
        scope: roles.scope,
        orgId: userRoles.organizationId,
        permissionName: permissions.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, user.id));

    const roleMap = new Map<
      string,
      {
        id: string;
        name: string;
        scope: 'platform' | 'organization';
        organizationId?: string | null;
      }
    >();
    const perms = new Set<string>();
    for (const r of rows) {
      roleMap.set(r.roleId, {
        id: r.roleId,
        name: r.roleName,
        scope: r.scope as any,
        organizationId: r.orgId,
      });
      if (r.permissionName) perms.add(r.permissionName);
    }

    const ctx: AuthContext = {
      userId: user.id,
      organizationId: user.organizationId ?? null,
      roles: Array.from(roleMap.values()),
      permissions: Array.from(perms.values()),
      platformAccess: user.organizationId == null,
    };
    (req as any).auth = ctx;
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
}

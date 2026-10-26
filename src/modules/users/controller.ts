import { Request, Response } from 'express';
import { db } from '../../database/client';
import { users } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { requirePermission, requireOrgScope, requirePlatform } from '../rbac/authz';
import { hashPassword } from '../auth/service';

export async function listUsers(req: Request, res: Response) {
  const auth = (req as any).auth;
  requirePermission(auth, 'user.read');
  if (!auth.platformAccess) {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.organizationId, auth.organizationId!));
    return res.json(rows);
  }
  const rows = await db.select().from(users);
  return res.json(rows);
}

export async function getUser(req: Request, res: Response) {
  const auth = (req as any).auth;
  requirePermission(auth, 'user.read');
  const { id } = req.params as { id: string };
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user)
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (!auth.platformAccess) requireOrgScope(auth, user.organizationId!);
  return res.json(user);
}

export async function createUser(req: Request, res: Response) {
  const auth = (req as any).auth;
  requirePermission(auth, 'user.create');
  const body = req.body as {
    email: string;
    name: string;
    password: string;
    organizationId?: string | null;
    status?: 'active' | 'suspended';
  };
  // Client admins can only create in their own org; platform admins can specify orgId or null
  const targetOrgId = auth.platformAccess ? (body.organizationId ?? null) : auth.organizationId;
  if (!auth.platformAccess && body.organizationId && body.organizationId !== auth.organizationId) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Cannot create user in another organization' },
    });
  }
  const passwordHash = await hashPassword(body.password);
  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      name: body.name,
      passwordHash,
      status: body.status ?? 'active',
      organizationId: targetOrgId as any,
    })
    .returning();
  return res.status(201).json(user);
}

export async function updateUser(req: Request, res: Response) {
  const auth = (req as any).auth;
  requirePermission(auth, 'user.update');
  const { id } = req.params as { id: string };
  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing)
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  if (!auth.platformAccess) requireOrgScope(auth, existing.organizationId!);
  const body = req.body as Partial<{
    name: string;
    password: string;
    status: 'active' | 'suspended';
  }>;
  const updates: any = {};
  if (body.name) updates.name = body.name;
  if (body.status) updates.status = body.status;
  if (body.password) updates.passwordHash = await hashPassword(body.password);
  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
  return res.json(user);
}

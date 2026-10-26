import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from './authz';
import { db } from '../../database/client';
import { roles, permissions } from '../../database/schema/core';

const router = Router();

router.get('/roles', authenticate, async (req, res) => {
  const auth = (req as any).auth;
  requirePermission(auth, 'role.read');
  const rows = await db.select().from(roles);
  return res.json(rows);
});

router.get('/permissions', authenticate, async (req, res) => {
  const auth = (req as any).auth;
  requirePermission(auth, 'permission.read');
  const rows = await db.select().from(permissions);
  return res.json(rows);
});

export default router;

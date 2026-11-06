import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from './authz';
import { db } from '../../database/client';
import { roles, permissions } from '../../database/schema/core';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.get(
  '/roles',
  authenticate,
  handle(async (req, res) => {
    const auth = req.auth;
    requirePermission(auth, 'role.read');
    const rows = await db.select().from(roles);
    return res.json(rows);
  })
);

router.get(
  '/permissions',
  authenticate,
  handle(async (req, res) => {
    const auth = req.auth;
    requirePermission(auth, 'permission.read');
    const rows = await db.select().from(permissions);
    return res.json(rows);
  })
);

export default router;

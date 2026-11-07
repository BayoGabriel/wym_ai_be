import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { validate } from '../../middleware/validate';
import {
  countUnreadInApp,
  listInAppNotifications,
  markAllInAppRead,
  markInAppRead,
} from './inapp';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.coerce.boolean().optional(),
});

const readAllSchema = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
});

router.use(authenticate);

function requireOrg(req: Request, res: Response): string | null {
  const orgId = req.auth.organizationId;
  if (!orgId) {
    res.status(400).json({ error: { code: 'NO_ORG', message: 'No organization in context' } });
    return null;
  }
  return orgId;
}

router.get(
  '/notifications',
  validate(listQuerySchema, 'query'),
  handle(async (req, res) => {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const { page, limit, unread } = req.query as unknown as {
      page: number;
      limit: number;
      unread?: boolean;
    };
    res.json(
      await listInAppNotifications({
        userId: req.auth.userId,
        organizationId: orgId,
        page,
        limit,
        unreadOnly: unread === true,
      })
    );
  })
);

router.get(
  '/notifications/unread-count',
  handle(async (req, res) => {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    res.json({ count: await countUnreadInApp(req.auth.userId, orgId) });
  })
);

router.post(
  '/notifications/read-all',
  validate(readAllSchema),
  handle(async (req, res) => {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    res.json(
      await markAllInAppRead({
        userId: req.auth.userId,
        organizationId: orgId,
        ids: req.body.ids,
      })
    );
  })
);

router.post(
  '/notifications/:id/read',
  handle(async (req, res) => {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const row = await markInAppRead({
      userId: req.auth.userId,
      organizationId: orgId,
      notificationId: req.params.id,
    });
    if (!row) {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
    }
    res.json(row);
  })
);

export default router;

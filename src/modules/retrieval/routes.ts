import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import { organizationHasProduct } from '../products/service';
import { retrieveRelevantKnowledge } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const retrieveSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

router.use(authenticate);

async function ensureAssistEntitlement(auth: any) {
  const ok =
    auth.organizationId && (await organizationHasProduct(auth.organizationId, 'WYMASSIST'));
  if (!ok) {
    const err: any = new Error('Forbidden: WYMASSIST not entitled');
    err.status = 403;
    throw err;
  }
}

router.post(
  '/knowledge/retrieve',
  validate(retrieveSchema, 'body'),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.read');
    await ensureAssistEntitlement(auth);
    const { query, topK, minScore } = req.body;
    const result = await retrieveRelevantKnowledge({
      organizationId: auth.organizationId!,
      query,
      topK,
      minScore,
    });
    res.json(result);
  })
);

export default router;

import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import { organizationHasProduct } from '../products/service';
import { generateResponse } from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const aiRequestSchema = z.object({
  message: z.string().min(1),
  language: z.string().optional(),
  conversationContext: z
    .object({
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
    })
    .optional(),
});

router.use(authenticate);

async function ensureAssistEntitlement(auth: any) {
  const ok =
    auth.organizationId && (await organizationHasProduct(auth.organizationId, 'WYMASSIST'));
  if (!ok) {
    const err: any = new Error('Forbidden: WYMASSIST not entitled');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

router.post(
  '/ai/respond',
  validate(aiRequestSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'knowledge.read');
    await ensureAssistEntitlement(auth);
    const body = req.body as any;

    try {
      const result = await generateResponse({
        organizationId: auth.organizationId!,
        message: body.message,
        conversationContext: body.conversationContext ?? null,
        userId: auth.userId,
        language: body.language,
      });
      return res.json(result);
    } catch (e: any) {
      return res.status(200).json({
        message:
          process.env.AI_FALLBACK_MESSAGE ||
          "I'm having trouble responding right now. Please try again shortly.",
        grounded: false,
        sources: [],
        meta: { error: 'AI_FAILURE' },
      });
    }
  })
);

export default router;

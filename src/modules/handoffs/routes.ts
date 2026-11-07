import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import {
  assignHandoffSchema,
  cancelHandoffSchema,
  createHandoffNoteSchema,
  HandoffStatus,
  listHandoffsQuerySchema,
  resolveHandoffSchema,
  staffReplySchema,
} from './schemas';
import { organizationHasProduct } from '../products/service';
import {
  addHandoffNote,
  assignHandoff,
  cancelHandoff,
  claimHandoff,
  createStaffHandoff,
  getHandoffById,
  listHandoffs,
  replyToHandoff,
  resolveHandoff,
} from './service';
import { AuthContext } from '../../types/auth';
import { PermissionValue } from '../rbac/permissions';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.use(authenticate);

function authOf(req: Request): AuthContext {
  return (req as unknown as { auth: AuthContext }).auth;
}

async function ensureAssistEntitlement(auth: AuthContext) {
  const ok =
    auth.organizationId && (await organizationHasProduct(auth.organizationId, 'WYMASSIST'));
  if (!ok) {
    const err = new Error('Forbidden: WYMASSIST not entitled') as Error & {
      status?: number;
      code?: string;
    };
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

function hasPermission(auth: AuthContext, permission: PermissionValue) {
  try {
    requirePermission(auth, permission);
    return true;
  } catch {
    return false;
  }
}

router.get(
  '/handoffs',
  validate(listHandoffsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.read');
    await ensureAssistEntitlement(auth);

    const query = req.query as unknown as {
      page: number;
      limit: number;
      status?: HandoffStatus;
      assignedTo?: string;
      order: 'asc' | 'desc';
    };

    const response = await listHandoffs({
      organizationId: auth.organizationId!,
      page: query.page,
      limit: query.limit,
      status: query.status,
      assignedTo: query.assignedTo,
      order: query.order,
    });
    res.json(response);
  })
);

router.post(
  '/handoffs',
  validate(z.object({ conversationId: z.string().uuid(), reason: z.string().max(500).optional() })),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const handoff = await createStaffHandoff({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      conversationId: (req.body as { conversationId: string }).conversationId,
      reason: (req.body as { reason?: string }).reason,
    });
    res.status(201).json(handoff);
  })
);

router.get(
  '/handoffs/:id',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.read');
    await ensureAssistEntitlement(auth);

    const handoff = await getHandoffById(auth.organizationId!, req.params.id);
    res.json(handoff);
  })
);

router.post(
  '/handoffs/:id/claim',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const handoff = await claimHandoff({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      handoffId: req.params.id,
    });
    res.json(handoff);
  })
);

router.post(
  '/handoffs/:id/assign',
  validate(assignHandoffSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.assign');
    await ensureAssistEntitlement(auth);

    const handoff = await assignHandoff({
      organizationId: auth.organizationId!,
      actorUserId: auth.userId,
      handoffId: req.params.id,
      userId: (req.body as { userId: string | null }).userId,
    });
    res.json(handoff);
  })
);

router.post(
  '/handoffs/:id/resolve',
  validate(resolveHandoffSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const handoff = await resolveHandoff({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      canAssign: hasPermission(auth, 'handoff.assign'),
      handoffId: req.params.id,
      resolutionSummary: (req.body as { resolutionSummary?: string }).resolutionSummary,
    });
    res.json(handoff);
  })
);

router.post(
  '/handoffs/:id/cancel',
  validate(cancelHandoffSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const handoff = await cancelHandoff({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      canAssign: hasPermission(auth, 'handoff.assign'),
      handoffId: req.params.id,
      reason: (req.body as { reason?: string }).reason,
    });
    res.json(handoff);
  })
);

router.post(
  '/handoffs/:id/notes',
  validate(createHandoffNoteSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const note = await addHandoffNote({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      handoffId: req.params.id,
      body: (req.body as { body: string }).body,
    });
    res.status(201).json(note);
  })
);

router.post(
  '/handoffs/:id/replies',
  validate(staffReplySchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'handoff.write');
    await ensureAssistEntitlement(auth);

    const body = req.body as { content: string; clientRequestId?: string };
    const result = await replyToHandoff({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      handoffId: req.params.id,
      content: body.content,
      clientRequestId: body.clientRequestId,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  })
);

export default router;

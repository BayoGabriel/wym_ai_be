import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { hasPermission, requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { organizationHasProduct } from '../products/service';
import { AuthContext } from '../../types/auth';
import {
  assignTaskSchema,
  createFlowDefinitionSchema,
  listInstancesQuerySchema,
  listTasksQuerySchema,
  submitFlowInstanceSchema,
  taskDecisionSchema,
  updateFlowDefinitionSchema,
} from './schemas';
import {
  assignTask,
  cancelInstance,
  createDefinition,
  decideTask,
  dispatchReminders,
  getDefinition,
  getInstanceDetail,
  listDefinitions,
  listInstances,
  listTasks,
  mapDefinition,
  mapInstance,
  submitInstance,
  updateDefinition,
} from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function authOf(req: Request): AuthContext {
  return (req as unknown as { auth: AuthContext }).auth;
}

async function requireFlow(req: Request) {
  const auth = authOf(req);
  if (!auth.organizationId || !(await organizationHasProduct(auth.organizationId, 'WYMFLOW'))) {
    throw new ApiError(403, 'FORBIDDEN', 'WymFlow AI is not enabled for this organization');
  }
  return auth;
}

router.use(authenticate);

// ── Definitions (flow.admin) ──

router.post(
  '/flow/definitions',
  validate(createFlowDefinitionSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.admin');
    const body = req.body as Parameters<typeof createDefinition>[0] & {
      organizationId?: string;
      userId?: string;
    };
    const d = await createDefinition({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      name: body.name,
      description: body.description,
      fields: body.fields,
      steps: body.steps,
      active: body.active,
    });
    res.status(201).json(mapDefinition(d));
  })
);

router.get(
  '/flow/definitions',
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.read');
    res.json({ items: await listDefinitions(auth.organizationId!) });
  })
);

router.get(
  '/flow/definitions/:id',
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.read');
    const d = await getDefinition(auth.organizationId!, req.params.id);
    res.json(mapDefinition(d));
  })
);

router.patch(
  '/flow/definitions/:id',
  validate(updateFlowDefinitionSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.admin');
    const d = await updateDefinition({
      organizationId: auth.organizationId!,
      id: req.params.id,
      userId: auth.userId,
      patch: req.body,
    });
    res.json(mapDefinition(d));
  })
);

// ── Instances (submissions) ──

router.post(
  '/flow/instances',
  validate(submitFlowInstanceSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.write');
    const body = req.body as {
      definitionId: string;
      title: string;
      data: Record<string, unknown>;
      documents: { filename: string; contentBase64: string }[];
    };
    const instance = await submitInstance({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      ...body,
    });
    res.status(201).json(mapInstance(instance));
  })
);

router.get(
  '/flow/instances',
  validate(listInstancesQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.read');
    const q = req.query as unknown as {
      status?: string;
      definitionId?: string;
      page: number;
      limit: number;
    };
    const result = await listInstances({ organizationId: auth.organizationId!, ...q });
    res.json({ items: result.items, page: q.page, limit: q.limit, total: result.total });
  })
);

router.get(
  '/flow/instances/:id',
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.read');
    res.json(await getInstanceDetail(auth.organizationId!, req.params.id));
  })
);

router.post(
  '/flow/instances/:id/cancel',
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.write');
    await cancelInstance({
      organizationId: auth.organizationId!,
      instanceId: req.params.id,
      userId: auth.userId,
    });
    res.status(204).send();
  })
);

// ── Tasks ──

router.get(
  '/flow/tasks',
  validate(listTasksQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.read');
    const q = req.query as unknown as {
      mine?: boolean;
      status?: string;
      page: number;
      limit: number;
    };
    const result = await listTasks({
      organizationId: auth.organizationId!,
      mineFor: q.mine ? auth.userId : undefined,
      status: q.status,
      page: q.page,
      limit: q.limit,
    });
    res.json({ items: result.items, page: q.page, limit: q.limit, total: result.total });
  })
);

router.post(
  '/flow/tasks/:id/assign',
  validate(assignTaskSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.admin');
    await assignTask({
      organizationId: auth.organizationId!,
      taskId: req.params.id,
      assignedTo: (req.body as { assignedTo: string | null }).assignedTo,
      actorUserId: auth.userId,
    });
    res.status(204).send();
  })
);

router.post(
  '/flow/tasks/:id/approve',
  validate(taskDecisionSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.write');
    const detail = await decideTask({
      organizationId: auth.organizationId!,
      taskId: req.params.id,
      userId: auth.userId,
      approve: true,
      note: (req.body as { note?: string }).note,
      canAdmin: hasPermission(auth, 'flow.admin'),
    });
    res.json(detail);
  })
);

router.post(
  '/flow/tasks/:id/reject',
  validate(taskDecisionSchema),
  handle(async (req, res) => {
    const auth = await requireFlow(req);
    requirePermission(auth, 'flow.write');
    const detail = await decideTask({
      organizationId: auth.organizationId!,
      taskId: req.params.id,
      userId: auth.userId,
      approve: false,
      note: (req.body as { note?: string }).note,
      canAdmin: hasPermission(auth, 'flow.admin'),
    });
    res.json(detail);
  })
);

// Reminder sweep — call from a scheduler/cron. Platform-scoped.
router.post(
  '/flow/reminders/dispatch',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'platform.manage');
    res.json(await dispatchReminders());
  })
);

export default router;

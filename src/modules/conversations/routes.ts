import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import {
  createConversationSchema,
  createMessageSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  updateConversationSchema,
} from './schemas';
import { organizationHasProduct } from '../products/service';
import {
  createConversation,
  createUserMessageAndGenerateAssistant,
  getConversationById,
  listConversationMessages,
  listConversations,
  updateConversation,
} from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

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
  '/conversations',
  validate(createConversationSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.create');
    await ensureAssistEntitlement(auth);

    const body = req.body as {
      channel: 'WEB' | 'API';
      externalSessionId?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };

    const conversation = await createConversation({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      channel: body.channel,
      externalSessionId: body.externalSessionId,
      title: body.title,
      metadata: body.metadata,
    });

    res.status(201).json(conversation);
  })
);

router.get(
  '/conversations',
  validate(listConversationsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.read');
    await ensureAssistEntitlement(auth);

    const { page, limit, status, order } = req.query as unknown as {
      page: number;
      limit: number;
      status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
      order: 'asc' | 'desc';
    };

    const response = await listConversations({
      organizationId: auth.organizationId!,
      page,
      limit,
      status,
      order,
    });
    res.json(response);
  })
);

router.get(
  '/conversations/:id',
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.read');
    await ensureAssistEntitlement(auth);

    const conversation = await getConversationById(auth.organizationId!, req.params.id);
    res.json(conversation);
  })
);

router.patch(
  '/conversations/:id',
  validate(updateConversationSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.update');
    await ensureAssistEntitlement(auth);

    const body = req.body as {
      title?: string;
      status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
      metadata?: Record<string, unknown>;
    };

    const conversation = await updateConversation({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      conversationId: req.params.id,
      title: body.title,
      status: body.status,
      metadata: body.metadata,
    });
    res.json(conversation);
  })
);

router.get(
  '/conversations/:id/messages',
  validate(listMessagesQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.read');
    await ensureAssistEntitlement(auth);

    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const response = await listConversationMessages({
      organizationId: auth.organizationId!,
      conversationId: req.params.id,
      page,
      limit,
    });
    res.json(response);
  })
);

router.post(
  '/conversations/:id/messages',
  validate(createMessageSchema),
  handle(async (req, res) => {
    const auth = (req as any).auth;
    requirePermission(auth, 'conversation.message.create');
    await ensureAssistEntitlement(auth);

    const body = req.body as {
      content: string;
      clientRequestId?: string;
      metadata?: Record<string, unknown>;
    };

    const response = await createUserMessageAndGenerateAssistant({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      conversationId: req.params.id,
      content: body.content,
      clientRequestId: body.clientRequestId,
      metadata: body.metadata,
    });
    res.status(201).json(response);
  })
);

export default router;

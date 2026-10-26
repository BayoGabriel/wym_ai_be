import { NextFunction, Request, Response, Router } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import {
  createPublicSessionSchema,
  publicMessageSchema,
  publicMessagesQuerySchema,
} from './schemas';
import { captureLeadSchema } from '../leads/schemas';
import { captureLeadFromPublicSession, toPublicLead } from '../leads/service';
import { requestHandoffSchema } from '../handoffs/schemas';
import {
  getPublicHandoffStatus,
  requestHandoffFromPublicSession,
  toPublicHandoff,
} from '../handoffs/service';
import {
  createPublicChatSession,
  getPublicSessionState,
  toPublicMessage,
  PublicSessionContext,
} from './service';
import {
  createUserMessageAndGenerateAssistant,
  getConversationOrThrow,
  listConversationMessages,
} from '../conversations/service';
import { authenticatePublicSession, PublicSessionRequest } from './middleware';
import { PostgresRateLimitStore } from './rateLimitStore';

const router = Router();

const configuredCorsOrigins = env.PUBLIC_CHAT_CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
router.use(
  cors({
    origin: configuredCorsOrigins.length ? configuredCorsOrigins : true,
  })
);

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function sessionOf(req: Request): PublicSessionContext {
  const ctx = (req as PublicSessionRequest).publicSession;
  if (!ctx) throw new ApiError(401, 'UNAUTHORIZED', 'Missing chat session credential');
  return ctx;
}

const sessionCreateLimiter = rateLimit({
  windowMs: env.PUBLIC_CHAT_SESSION_WINDOW_MS,
  max: env.PUBLIC_CHAT_SESSION_CREATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(),
  keyGenerator: (req) => `${req.ip}:${req.body?.organizationSlug ?? ''}`,
});

const messageLimiter = rateLimit({
  windowMs: env.PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS,
  max: env.PUBLIC_CHAT_MESSAGE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(),
  keyGenerator: (req) => `msg:${(req as PublicSessionRequest).publicSession?.sessionId ?? req.ip}`,
});

const readLimiter = rateLimit({
  windowMs: env.PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS,
  max: env.PUBLIC_CHAT_READ_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(),
  keyGenerator: (req) => `read:${(req as PublicSessionRequest).publicSession?.sessionId ?? req.ip}`,
});

const leadLimiter = rateLimit({
  windowMs: env.PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS,
  max: env.PUBLIC_CHAT_LEAD_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(),
  keyGenerator: (req) => `lead:${(req as PublicSessionRequest).publicSession?.sessionId ?? req.ip}`,
});

const handoffLimiter = rateLimit({
  windowMs: env.PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS,
  max: env.PUBLIC_CHAT_HANDOFF_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(),
  keyGenerator: (req) =>
    `handoff:${(req as PublicSessionRequest).publicSession?.sessionId ?? req.ip}`,
});

router.post(
  '/sessions',
  sessionCreateLimiter,
  validate(createPublicSessionSchema),
  handle(async (req, res) => {
    const body = req.body as {
      organizationSlug: string;
      visitorName?: string;
      metadata?: Record<string, unknown>;
    };

    const session = await createPublicChatSession({
      organizationSlug: body.organizationSlug,
      visitorName: body.visitorName,
      metadata: body.metadata,
      origin: req.headers.origin,
    });

    res.status(201).json(session);
  })
);

router.get(
  '/session',
  authenticatePublicSession,
  readLimiter,
  handle(async (req, res) => {
    const state = await getPublicSessionState(sessionOf(req));
    res.json(state);
  })
);

router.post(
  '/messages',
  authenticatePublicSession,
  messageLimiter,
  validate(publicMessageSchema),
  handle(async (req, res) => {
    const ctx = sessionOf(req);
    const body = req.body as { content: string; clientRequestId?: string };

    const result = await createUserMessageAndGenerateAssistant({
      organizationId: ctx.organizationId,
      userId: null,
      conversationId: ctx.conversationId,
      content: body.content,
      clientRequestId: body.clientRequestId,
      metadata: { source: 'public_widget' },
    });

    res.status(201).json({
      userMessage: toPublicMessage(result.userMessage),
      assistantMessage: toPublicMessage(result.assistantMessage),
      idempotentReplay: result.idempotentReplay,
    });
  })
);

router.get(
  '/messages',
  authenticatePublicSession,
  readLimiter,
  validate(publicMessagesQuerySchema, 'query'),
  handle(async (req, res) => {
    const ctx = sessionOf(req);
    await getConversationOrThrow(ctx.organizationId, ctx.conversationId);

    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const response = await listConversationMessages({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      page,
      limit,
    });

    res.json({
      items: response.items
        .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT' || m.role === 'AGENT')
        .map(toPublicMessage),
      page: response.page,
      limit: response.limit,
      total: response.total,
    });
  })
);

router.post(
  '/leads',
  authenticatePublicSession,
  leadLimiter,
  validate(captureLeadSchema),
  handle(async (req, res) => {
    const ctx = sessionOf(req);
    const body = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      enquiryCategory?: string;
      summary?: string;
      consentToContact?: boolean;
      clientRequestId?: string;
    };

    const result = await captureLeadFromPublicSession({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      sessionId: ctx.sessionId,
      ...body,
    });

    res.status(result.idempotentReplay || result.deduplicated ? 200 : 201).json(
      toPublicLead(result.lead, {
        idempotentReplay: result.idempotentReplay,
        deduplicated: result.deduplicated,
      })
    );
  })
);

router.post(
  '/handoff',
  authenticatePublicSession,
  handoffLimiter,
  validate(requestHandoffSchema),
  handle(async (req, res) => {
    const ctx = sessionOf(req);
    const body = req.body as { reason?: string };

    const result = await requestHandoffFromPublicSession({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      sessionId: ctx.sessionId,
      reason: body.reason,
    });

    res
      .status(result.existing ? 200 : 201)
      .json(toPublicHandoff(result.handoff, { alreadyActive: result.existing }));
  })
);

router.get(
  '/handoff',
  authenticatePublicSession,
  readLimiter,
  handle(async (req, res) => {
    const ctx = sessionOf(req);
    const handoff = await getPublicHandoffStatus({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      sessionId: ctx.sessionId,
    });
    res.json({ handoff: handoff ? toPublicHandoff(handoff) : null });
  })
);

export default router;

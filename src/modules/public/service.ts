import { createHash, randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  chatSessions,
  conversations,
  messages,
  organizations,
} from '../../database/schema/core';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import { organizationHasProduct } from '../products/service';

export type PublicSessionContext = {
  sessionId: string;
  organizationId: string;
  conversationId: string;
  expiresAt: Date;
};

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken() {
  return `wymcs_${randomBytes(32).toString('base64url')}`;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseOrigins(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is string => typeof o === 'string')
      .map((o) => normalizeOrigin(o))
      .filter((o): o is string => o !== null);
  } catch {
    return [];
  }
}

export function assertRequestOrigin(params: { allowedOrigins: string[]; origin?: string }) {
  const { allowedOrigins, origin } = params;
  if (!origin) {
    if (env.PUBLIC_CHAT_REQUIRE_ORIGIN && allowedOrigins.length > 0) {
      throw new ApiError(403, 'ORIGIN_REQUIRED', 'An allowed Origin header is required');
    }
    return;
  }
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.length > 0 && (!normalized || !allowedOrigins.includes(normalized))) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not permitted for this assistant');
  }
}

export async function createPublicChatSession(params: {
  organizationSlug: string;
  visitorName?: string;
  metadata?: Record<string, unknown>;
  origin?: string;
}) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, params.organizationSlug))
    .limit(1);

  if (!org || org.status !== 'active') {
    throw new ApiError(404, 'NOT_FOUND', 'Assistant not available');
  }

  const entitled = await organizationHasProduct(org.id, 'WYMASSIST');
  if (!entitled) {
    throw new ApiError(403, 'PUBLIC_CHAT_UNAVAILABLE', 'Public chat is not available');
  }

  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, org.id))
    .limit(1);

  if (!config || !config.publicChatEnabled) {
    throw new ApiError(403, 'PUBLIC_CHAT_DISABLED', 'Public chat is not enabled');
  }

  assertRequestOrigin({
    allowedOrigins: parseOrigins(config.allowedOrigins),
    origin: params.origin,
  });

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + env.PUBLIC_CHAT_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const title = params.visitorName ? `Visitor: ${params.visitorName}` : 'Public chat visitor';
  const conversationMetadata = JSON.stringify({
    source: 'public_widget',
    ...(params.metadata ?? {}),
  });

  const { conversation, session } = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({
        organizationId: org.id,
        status: 'ACTIVE',
        channel: 'WEB',
        title,
        metadata: conversationMetadata,
      })
      .returning();

    const [session] = await tx
      .insert(chatSessions)
      .values({
        organizationId: org.id,
        conversationId: conversation.id,
        tokenHash: hashSessionToken(token),
        visitorLabel: params.visitorName ?? null,
        expiresAt,
        lastSeenAt: new Date(),
      })
      .returning();

    return { conversation, session };
  });

  await recordAudit({
    organizationId: org.id,
    actorUserId: null,
    action: 'public_chat.session.created',
    resourceType: 'chat_session',
    resourceId: session.id,
    metadata: { channel: 'WEB', hasVisitorName: !!params.visitorName },
  });

  return {
    sessionId: session.id,
    sessionToken: token,
    expiresAt: session.expiresAt,
    assistant: {
      name: config.assistantName ?? null,
      welcomeMessage: config.welcomeMessage ?? null,
      tone: config.tone ?? null,
    },
    conversation: {
      id: conversation.id,
      status: conversation.status,
    },
  };
}

export async function resolveSessionToken(token: string): Promise<PublicSessionContext> {
  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.revokedAt) {
    throw new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid or revoked');
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, 'SESSION_EXPIRED', 'Chat session has expired');
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1);
  if (!org || org.status !== 'active') {
    throw new ApiError(403, 'PUBLIC_CHAT_UNAVAILABLE', 'Public chat is not available');
  }

  const entitled = await organizationHasProduct(session.organizationId, 'WYMASSIST');
  if (!entitled) {
    throw new ApiError(403, 'PUBLIC_CHAT_UNAVAILABLE', 'Public chat is not available');
  }

  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, session.organizationId))
    .limit(1);
  if (!config?.publicChatEnabled) {
    throw new ApiError(403, 'PUBLIC_CHAT_DISABLED', 'Public chat is not enabled');
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, session.conversationId),
        eq(conversations.organizationId, session.organizationId)
      )
    )
    .limit(1);

  if (!conversation) {
    throw new ApiError(401, 'INVALID_SESSION', 'Chat session is invalid');
  }

  await db
    .update(chatSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(chatSessions.id, session.id));

  return {
    sessionId: session.id,
    organizationId: session.organizationId,
    conversationId: session.conversationId,
    expiresAt: session.expiresAt,
  };
}

export async function getPublicSessionState(ctx: PublicSessionContext) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, ctx.conversationId))
    .limit(1);

  const [config] = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, ctx.organizationId))
    .limit(1);

  return {
    sessionId: ctx.sessionId,
    expiresAt: ctx.expiresAt,
    assistant: {
      name: config?.assistantName ?? null,
      welcomeMessage: config?.welcomeMessage ?? null,
      tone: config?.tone ?? null,
    },
    conversation: conversation ? { id: conversation.id, status: conversation.status } : null,
  };
}

function parseMetadata(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

type MessageRow = typeof messages.$inferSelect;

export function toPublicMessage(row: MessageRow) {
  const metadata = parseMetadata(row.metadata);
  const base = {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  };
  if (row.role !== 'ASSISTANT') return base;
  return {
    ...base,
    grounded: !!metadata?.grounded,
    sources: Array.isArray(metadata?.sources) ? metadata.sources : [],
  };
}

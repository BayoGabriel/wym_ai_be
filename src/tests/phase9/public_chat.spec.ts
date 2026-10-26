import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  chatSessions,
  conversations,
  organizations,
} from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';

async function enablePublicChat(organizationId: string, allowedOrigins?: string[]) {
  const existing = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, organizationId))
    .limit(1);

  const values = {
    assistantName: 'Test Assistant',
    welcomeMessage: 'Hello, how can I help?',
    publicChatEnabled: true,
    allowedOrigins: allowedOrigins ? JSON.stringify(allowedOrigins) : null,
  };

  if (existing.length) {
    await db
      .update(assistantConfigurations)
      .set(values)
      .where(eq(assistantConfigurations.organizationId, organizationId));
    return;
  }
  await db.insert(assistantConfigurations).values({ organizationId, ...values });
}

describe.sequential('Phase 9: public WymAssist chat API', () => {
  const app = createApp();
  type OrgRow = typeof organizations.$inferSelect;
  let orgA: OrgRow;
  let orgB: OrgRow;
  let orgNoEnt: OrgRow;
  let orgNoPublicChat: OrgRow;
  let orgOrigins: OrgRow;
  let staffTokenA: string;
  let sessionToken = '';
  let conversationId = '';

  beforeAll(async () => {
    orgA = await ensureOrg('Public Chat Org A', 'public-chat-org-a');
    orgB = await ensureOrg('Public Chat Org B', 'public-chat-org-b');
    orgNoEnt = await ensureOrg('Public Chat No Ent', 'public-chat-no-ent');
    orgNoPublicChat = await ensureOrg('Public Chat Disabled', 'public-chat-disabled');
    orgOrigins = await ensureOrg('Public Chat Origins', 'public-chat-origins');

    const userA = await ensureUser('pubchat-a@example.com', orgA.id);

    const role = await ensureRole('PubChat Staff', 'organization');
    for (const p of [
      'conversation.read',
      'conversation.create',
      'conversation.update',
      'conversation.message.create',
    ]) {
      await grantRolePermission(role.id, p);
    }
    await assignUserRole({ userId: userA.id, roleId: role.id, organizationId: orgA.id });

    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgNoPublicChat.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgOrigins.id, status: 'active' });

    await enablePublicChat(orgA.id);
    await enablePublicChat(orgB.id);
    await enablePublicChat(orgOrigins.id, ['https://allowed.example.com']);
    // orgNoPublicChat gets entitlement but no publicChatEnabled config

    staffTokenA = (await issueTokens({ id: userA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;

    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  it('creates a public session for an eligible organization', async () => {
    const res = await request(app).post('/api/v1/public/assist/sessions').send({
      organizationSlug: orgA.slug,
      visitorName: 'Test Visitor',
    });

    expect(res.status).toBe(201);
    expect(typeof res.body.sessionToken).toBe('string');
    expect(res.body.sessionToken.startsWith('wymcs_')).toBe(true);
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.assistant.name).toBe('Test Assistant');
    expect(res.body.conversation.status).toBe('ACTIVE');

    sessionToken = res.body.sessionToken;
    conversationId = res.body.conversation.id;
  });

  it('rejects session creation for orgs without entitlement or public chat', async () => {
    const noEnt = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgNoEnt.slug });
    expect(noEnt.status).toBe(403);
    expect(noEnt.body.error.code).toBe('PUBLIC_CHAT_UNAVAILABLE');

    const disabled = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgNoPublicChat.slug });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('PUBLIC_CHAT_DISABLED');

    const unknown = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: 'does-not-exist' });
    expect(unknown.status).toBe(404);
  });

  it('enforces per-organization allowed origins', async () => {
    const bad = await request(app)
      .post('/api/v1/public/assist/sessions')
      .set('Origin', 'https://evil.example.com')
      .send({ organizationSlug: orgOrigins.slug });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const good = await request(app)
      .post('/api/v1/public/assist/sessions')
      .set('Origin', 'https://allowed.example.com')
      .send({ organizationSlug: orgOrigins.slug });
    expect(good.status).toBe(201);
  });

  it('returns session state for a valid credential', async () => {
    const res = await request(app)
      .get('/api/v1/public/assist/session')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(conversationId);
    expect(res.body.conversation.status).toBe('ACTIVE');
    expect(res.body.assistant.name).toBe('Test Assistant');
  });

  it('rejects missing, malformed, and foreign credentials', async () => {
    const missing = await request(app).get('/api/v1/public/assist/session');
    expect(missing.status).toBe(401);

    const garbage = await request(app)
      .get('/api/v1/public/assist/session')
      .set('Authorization', 'Bearer wymcs_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead');
    expect(garbage.status).toBe(401);

    // A visitor credential must not authenticate against staff endpoints
    const staffAttempt = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(staffAttempt.status).toBe(401);
  });

  it('exchanges a visitor message through the existing AI pipeline', async () => {
    const res = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: 'What services do you offer?', clientRequestId: 'pub-msg-0001' });

    expect(res.status).toBe(201);
    expect(res.body.userMessage.role).toBe('USER');
    expect(res.body.userMessage.content).toContain('services');
    expect(res.body.assistantMessage.role).toBe('ASSISTANT');
    expect(typeof res.body.assistantMessage.content).toBe('string');
    expect(res.body.idempotentReplay).toBe(false);
    // Public shape must not leak internal fields
    expect(res.body.userMessage.organizationId).toBeUndefined();
    expect(res.body.userMessage.metadata).toBeUndefined();
  });

  it('replays idempotent retries without duplicating messages', async () => {
    const first = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: 'Repeatable question', clientRequestId: 'pub-msg-0002' });
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);

    const second = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: 'Repeatable question', clientRequestId: 'pub-msg-0002' });
    expect(second.status).toBe(201);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.userMessage.id).toBe(first.body.userMessage.id);
    expect(second.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
  });

  it('returns conversation history scoped to the session', async () => {
    const res = await request(app)
      .get('/api/v1/public/assist/messages?page=1&limit=50')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant from prior tests
    for (const m of res.body.items) {
      expect(['USER', 'ASSISTANT']).toContain(m.role);
      expect(m.organizationId).toBeUndefined();
      expect(m.metadata).toBeUndefined();
      expect(m.clientRequestId).toBeUndefined();
    }
  });

  it('rejects invalid message payloads', async () => {
    const empty = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: '' });
    expect(empty.status).toBe(400);

    const oversized = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: 'x'.repeat(2100) });
    expect(oversized.status).toBe(400);
  });

  it('keeps sessions isolated between visitors and organizations', async () => {
    const s2 = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgB.slug, visitorName: 'OrgB Visitor' });
    expect(s2.status).toBe(201);
    const tokenB = s2.body.sessionToken;

    // Session B's history must not contain org A's conversation messages
    const hist = await request(app)
      .get('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(hist.status).toBe(200);
    expect(hist.body.total).toBe(0);

    // Session B cannot be pointed at org A's conversation — the credential
    // is bound server-side, so this simply has no effect on scoping.
    const msg = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ content: 'Hello from B' });
    expect(msg.status).toBe(201);

    const [msgRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, s2.body.conversation.id))
      .limit(1);
    expect(msgRow.organizationId).toBe(orgB.id);
  });

  it('blocks new messages after staff closes the conversation', async () => {
    const close = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ status: 'CLOSED' });
    expect(close.status).toBe(200);

    const res = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content: 'Are you still there?' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSATION_READ_ONLY');
  });

  it('rejects expired and revoked session credentials', { timeout: 30000 }, async () => {
    // Expired: force expiry in the past
    const expired = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgA.slug });
    expect(expired.status).toBe(201);
    await db
      .update(chatSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatSessions.id, expired.body.sessionId));

    const expiredRes = await request(app)
      .get('/api/v1/public/assist/session')
      .set('Authorization', `Bearer ${expired.body.sessionToken}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('SESSION_EXPIRED');

    // Revoked: archive a separate conversation via staff API
    const revoked = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgA.slug });
    expect(revoked.status).toBe(201);

    await request(app)
      .patch(`/api/v1/conversations/${revoked.body.conversation.id}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ status: 'CLOSED' });
    const arch = await request(app)
      .patch(`/api/v1/conversations/${revoked.body.conversation.id}`)
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({ status: 'ARCHIVED' });
    expect(arch.status).toBe(200);

    const revokedRes = await request(app)
      .get('/api/v1/public/assist/session')
      .set('Authorization', `Bearer ${revoked.body.sessionToken}`);
    expect(revokedRes.status).toBe(401);
    expect(revokedRes.body.error.code).toBe('INVALID_SESSION');
  });

  it('enforces message rate limits per session', { timeout: 60000 }, async () => {
    const s = await request(app)
      .post('/api/v1/public/assist/sessions')
      .send({ organizationSlug: orgB.slug });
    expect(s.status).toBe(201);
    const token = s.body.sessionToken;

    // Limiter counts hits before payload validation, so invalid payloads exercise the
    // same counter without paying the serialized AI-generation cost per request.
    const results = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app)
          .post('/api/v1/public/assist/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({ content: '' })
      )
    );
    expect(results.filter((r) => r.status === 400).length).toBe(30);
    expect(results.filter((r) => r.status === 429).length).toBe(1);
  });
});

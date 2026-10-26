import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { issueTokens } from '../../modules/auth/service';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';
import * as aiProviderModule from '../../modules/ai/provider';

describe.sequential('Phase 7: conversation messages + AI integration', () => {
  const app = createApp();
  let orgA: any;
  let orgB: any;
  let tokenA: string;
  let tokenB: string;
  let tokenReadOnly: string;
  let conversationId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Conversation Msg Org A', 'conversation-msg-org-a');
    orgB = await ensureOrg('Conversation Msg Org B', 'conversation-msg-org-b');
    const userA = await ensureUser('conv-msg-a@example.com', orgA.id);
    const userB = await ensureUser('conv-msg-b@example.com', orgB.id);
    const userReadOnly = await ensureUser('conv-readonly@example.com', orgA.id);

    const fullRole = await ensureRole('Conversation Full Access', 'organization');
    for (const permission of [
      'conversation.read',
      'conversation.create',
      'conversation.update',
      'conversation.message.create',
      'knowledge.read',
    ]) {
      await grantRolePermission(fullRole.id, permission);
    }

    const readRole = await ensureRole('Conversation Read Only', 'organization');
    await grantRolePermission(readRole.id, 'conversation.read');
    await grantRolePermission(readRole.id, 'knowledge.read');

    await assignUserRole({ userId: userA.id, roleId: fullRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: userB.id, roleId: fullRole.id, organizationId: orgB.id });
    await assignUserRole({
      userId: userReadOnly.id,
      roleId: readRole.id,
      organizationId: orgA.id,
    });

    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });

    tokenA = (await issueTokens({ id: userA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: userB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;
    tokenReadOnly = (
      await issueTokens({ id: userReadOnly.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;

    const createConversationRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ channel: 'API', title: 'Message flow conversation' });
    expect(createConversationRes.status).toBe(201);
    conversationId = createConversationRes.body.id;
  });

  it('creates user message, generates assistant response, and persists both', async () => {
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'What are your opening hours?', clientRequestId: 'msg-flow-001' });
    expect(res.status).toBe(201);
    expect(res.body.userMessage.role).toBe('USER');
    expect(res.body.userMessage.content).toContain('opening hours');
    expect(res.body.assistantMessage.role).toBe('ASSISTANT');
    expect(typeof res.body.assistantMessage.content).toBe('string');
    expect(Array.isArray(res.body.ai.sources)).toBe(true);
  });

  it('supports idempotent retries using clientRequestId', async () => {
    const first = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Do you have weekend support?', clientRequestId: 'msg-flow-002' });
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);

    const second = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Do you have weekend support?', clientRequestId: 'msg-flow-002' });
    expect(second.status).toBe(201);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.userMessage.id).toBe(first.body.userMessage.id);
    expect(second.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
  });

  it('lists messages in chronological order and paginates', async () => {
    const res = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages?page=1&limit=10`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(1);
    for (let i = 1; i < res.body.items.length; i++) {
      const prev = new Date(res.body.items[i - 1].createdAt).getTime();
      const next = new Date(res.body.items[i].createdAt).getTime();
      expect(prev).toBeLessThanOrEqual(next);
    }
  });

  it('prevents posting to CLOSED/ARCHIVED conversations', async () => {
    const closeRes = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'CLOSED' });
    expect(closeRes.status).toBe(200);

    const postClosedRes = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Can I still send?' });
    expect(postClosedRes.status).toBe(409);
    expect(postClosedRes.body.error.code).toBe('CONVERSATION_READ_ONLY');

    const archiveRes = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ARCHIVED' });
    expect(archiveRes.status).toBe(200);

    const postArchivedRes = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Still blocked?' });
    expect(postArchivedRes.status).toBe(409);
  });

  it('enforces RBAC and tenant isolation for messages', async () => {
    const noWrite = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenReadOnly}`)
      .send({ content: 'No permission write' });
    expect(noWrite.status).toBe(403);

    const crossTenantRead = await request(app)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossTenantRead.status).toBe(404);

    const crossTenantWrite = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ content: 'Cross tenant write' });
    expect(crossTenantWrite.status).toBe(404);
  });

  it('returns safe fallback payload when AI provider fails', async () => {
    const openRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ channel: 'API', title: 'Failure flow' });
    expect(openRes.status).toBe(201);
    const openId = openRes.body.id;

    const spy = vi.spyOn(aiProviderModule, 'getLLMProvider').mockImplementation((): any => ({
      name: 'LOCAL_FAKE_FAIL',
      model: 'local-fake',
      async generate() {
        throw new Error('provider failure');
      },
    }));

    const res = await request(app)
      .post(`/api/v1/conversations/${openId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Trigger failure', clientRequestId: 'msg-fail-001' });

    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.role).toBe('ASSISTANT');
    expect(res.body.ai.grounded).toBe(false);
    expect(res.body.ai.meta.error).toBe('AI_FAILURE');
    spy.mockRestore();
  });
});

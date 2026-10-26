import { beforeAll, describe, expect, it } from 'vitest';
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

describe.sequential('Phase 7: conversations core', () => {
  const app = createApp();
  let orgA: any;
  let orgB: any;
  let tokenA: string;
  let tokenB: string;
  let tokenNoEntitlement: string;
  let conversationId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Conversation Org A', 'conversation-org-a');
    orgB = await ensureOrg('Conversation Org B', 'conversation-org-b');
    const orgNoEnt = await ensureOrg('Conversation Org No Ent', 'conversation-org-no-ent');

    const userA = await ensureUser('conv-a@example.com', orgA.id);
    const userB = await ensureUser('conv-b@example.com', orgB.id);
    const userNoEnt = await ensureUser('conv-no-ent@example.com', orgNoEnt.id);

    const role = await ensureRole('Conversation Tester', 'organization');
    for (const permission of [
      'conversation.read',
      'conversation.create',
      'conversation.update',
      'conversation.message.create',
      'knowledge.read',
    ]) {
      await grantRolePermission(role.id, permission);
    }

    await assignUserRole({ userId: userA.id, roleId: role.id, organizationId: orgA.id });
    await assignUserRole({ userId: userB.id, roleId: role.id, organizationId: orgB.id });
    await assignUserRole({
      userId: userNoEnt.id,
      roleId: role.id,
      organizationId: orgNoEnt.id,
    });

    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });

    tokenA = (await issueTokens({ id: userA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: userB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;
    tokenNoEntitlement = (
      await issueTokens({ id: userNoEnt.id, organizationId: orgNoEnt.id, status: 'active' })
    ).accessToken;
  });

  it('creates a conversation for authenticated org user', async () => {
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        channel: 'API',
        externalSessionId: `conv-core-${Date.now()}`,
        title: 'Initial support issue',
        metadata: { locale: 'en' },
      });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(orgA.id);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.channel).toBe('API');
    expect(typeof res.body.externalSessionId).toBe('string');
    expect(res.body.metadata.locale).toBe('en');
    conversationId = res.body.id;
  });

  it('lists only organization-scoped conversations with pagination', async () => {
    const res = await request(app)
      .get('/api/v1/conversations?page=1&limit=10&status=ACTIVE&order=desc')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.total).toBeGreaterThan(0);
    expect(
      res.body.items.every((c: any) => c.organizationId === orgA.id && c.status === 'ACTIVE')
    ).toBe(true);
  });

  it('gets own conversation and blocks cross-tenant access', async () => {
    const own = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(conversationId);
    expect(own.body.organizationId).toBe(orgA.id);

    const cross = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
  });

  it('updates conversation title and status with valid transitions', async () => {
    const closeRes = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Resolved issue',
        status: 'CLOSED',
        metadata: { resolution: 'self-service' },
      });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.title).toBe('Resolved issue');
    expect(closeRes.body.status).toBe('CLOSED');
    expect(closeRes.body.metadata.resolution).toBe('self-service');

    const archiveRes = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ARCHIVED' });
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.status).toBe('ARCHIVED');
  });

  it('rejects invalid status transition ARCHIVED -> ACTIVE', async () => {
    const res = await request(app)
      .patch(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('enforces validation and auth requirements', async () => {
    const unauthenticated = await request(app)
      .post('/api/v1/conversations')
      .send({ channel: 'API' });
    expect(unauthenticated.status).toBe(401);

    const invalid = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ channel: 'WHATSAPP' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires active WymAssist entitlement', async () => {
    const noEntRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenNoEntitlement}`)
      .send({ channel: 'API' });
    expect(noEntRes.status).toBe(403);

    await setAssistEntitlement({ organizationId: orgA.id, status: 'inactive' });
    const inactiveAssignRes = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ channel: 'API' });
    expect(inactiveAssignRes.status).toBe(403);

    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
  });
});

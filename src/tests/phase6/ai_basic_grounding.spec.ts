import { describe, it, beforeAll, expect } from 'vitest';
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

describe('Phase 6: AI - grounded response with org knowledge', () => {
  const app = createApp();
  let orgA: any;
  let tokenA: string;

  beforeAll(async () => {
    orgA = await ensureOrg('AIBasic', 'ai-basic');
    const uA = await ensureUser('aibasic@example.com', orgA.id);

    const role = await ensureRole('AI Tester', 'organization');
    for (const perm of ['knowledge.read', 'knowledge.write']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: uA.id, roleId: role.id, organizationId: orgA.id });
    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });

    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
  });

  it('creates knowledge, processes+embeds, and gets grounded AI response', async () => {
    const createRes = await request(app)
      .post('/api/v1/knowledge')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Hours',
        description: 'Business hours',
        content: 'Our office closes at 5 PM.',
        category: 'GENERAL',
        status: 'ACTIVE',
      });
    expect(createRes.status).toBe(201);
    const knowledgeId = createRes.body.id;

    const procRes = await request(app)
      .post(`/api/v1/knowledge/${knowledgeId}/process`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(procRes.status).toBe(200);

    const aiRes = await request(app)
      .post('/api/v1/ai/respond')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'What time do you close?' });
    expect(aiRes.status).toBe(200);
    expect(typeof aiRes.body.message).toBe('string');
    expect(aiRes.body.grounded).toBeTypeOf('boolean');
    expect(aiRes.body.sources).toBeInstanceOf(Array);
  });
});

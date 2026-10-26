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

describe('Phase 3: Knowledge auth and tenant isolation', () => {
  const app = createApp();
  let orgA: any;
  let orgB: any;
  let tokenA: string;
  let tokenB: string;
  let itemAId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('KA', 'ka');
    orgB = await ensureOrg('KB', 'kb');
    const uA = await ensureUser('ka@example.com', orgA.id);
    const uB = await ensureUser('kb@example.com', orgB.id);

    const role = await ensureRole('Knowledge Tester', 'organization');
    for (const perm of ['knowledge.read', 'knowledge.write']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: uA.id, roleId: role.id, organizationId: orgA.id });
    await assignUserRole({ userId: uB.id, roleId: role.id, organizationId: orgB.id });

    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });

    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: uB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/v1/knowledge');
    expect(res.status).toBe(401);
  });

  it('Org A creates a text knowledge item', async () => {
    const res = await request(app)
      .post('/api/v1/knowledge')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'OrgA FAQ', description: 'A', content: '...', category: 'FAQ' });
    expect(res.status).toBe(201);
    itemAId = res.body.id;
  });

  it("Org B cannot read Org A's item", async () => {
    const res = await request(app)
      .get(`/api/v1/knowledge/${itemAId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});

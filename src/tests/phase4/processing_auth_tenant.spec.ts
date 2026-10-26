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

describe('Phase 4: Processing - Auth & Tenant isolation', () => {
  const app = createApp();
  let orgA: any, orgB: any;
  let tokenA: string, tokenB: string;
  let itemA: string;

  beforeAll(async () => {
    orgA = await ensureOrg('ProcAuthA', 'proc-auth-a');
    orgB = await ensureOrg('ProcAuthB', 'proc-auth-b');
    const uA = await ensureUser('procauthA@example.com', orgA.id);
    const uB = await ensureUser('procauthB@example.com', orgB.id);

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

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/knowledge/some-id/process');
    expect(res.status).toBe(401);
  });

  it('Org A cannot process Org B knowledge', async () => {
    const createRes = await request(app)
      .post('/api/v1/knowledge')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Org A Knowledge Item',
        description: 'A knowledge item for Org A',
        content: 'Some content for processing tests',
        category: 'GENERAL',
        status: 'ACTIVE',
      });
    expect(createRes.status).toBe(201);
    itemA = createRes.body.id;

    const res = await request(app)
      .post(`/api/v1/knowledge/${itemA}/process`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});

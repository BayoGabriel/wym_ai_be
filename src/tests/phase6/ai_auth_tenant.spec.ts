import { describe, it, beforeAll, expect } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { organizationProducts } from '../../database/schema/core';
import { eq } from 'drizzle-orm';
import { issueTokens } from '../../modules/auth/service';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';

describe('Phase 6: AI - auth & entitlement', () => {
  const app = createApp();
  let orgA: any;
  let tokenA: string;

  beforeAll(async () => {
    orgA = await ensureOrg('AIAuth NoEntitle', 'ai-auth-no-entitle');
    const uA = await ensureUser('aiauth-noentitle@example.com', orgA.id);

    const role = await ensureRole('AI Tester', 'organization');
    await grantRolePermission(role.id, 'knowledge.read');
    await assignUserRole({ userId: uA.id, roleId: role.id, organizationId: orgA.id });

    // Clean slate: remove any leftover entitlements from prior test runs
    await db.delete(organizationProducts).where(eq(organizationProducts.organizationId, orgA.id));

    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/ai/respond').send({ message: 'Hi' });
    expect(res.status).toBe(401);
  });

  it('rejects without WymAssist entitlement', async () => {
    const res = await request(app)
      .post('/api/v1/ai/respond')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'Hi' });
    expect(res.status).toBe(403);
  });

  it('allows when entitled', async () => {
    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    const res = await request(app)
      .post('/api/v1/ai/respond')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'Hi' });
    expect(res.status).toBe(200);
  });
});

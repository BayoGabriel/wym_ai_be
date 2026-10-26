import { describe, it, beforeAll, expect, vi } from 'vitest';
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
import * as providerModule from '../../modules/ai/provider';

describe('Phase 6: AI - fallback and provider failures', () => {
  const app = createApp();
  let orgA: any;
  let tokenA: string;

  beforeAll(async () => {
    orgA = await ensureOrg('AIFallback', 'ai-fallback');
    const uA = await ensureUser('aifallback@example.com', orgA.id);

    const role = await ensureRole('AI Tester', 'organization');
    await grantRolePermission(role.id, 'knowledge.read');
    await assignUserRole({ userId: uA.id, roleId: role.id, organizationId: orgA.id });
    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });

    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
  });

  it('returns fallback when no knowledge exists', async () => {
    const aiRes = await request(app)
      .post('/api/v1/ai/respond')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'What time do you close?' });
    expect(aiRes.status).toBe(200);
    expect(typeof aiRes.body.message).toBe('string');
    expect(aiRes.body.sources).toBeInstanceOf(Array);
  });

  it('handles provider failure with friendly response', async () => {
    const spy = vi.spyOn(providerModule, 'getLLMProvider').mockImplementation((): any => ({
      name: 'LOCAL_FAKE_FAIL',
      model: 'local-fake',
      async generate() {
        throw new Error('provider down');
      },
    }));
    const aiRes = await request(app)
      .post('/api/v1/ai/respond')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'Hi' });
    expect(aiRes.status).toBe(200);
    expect(aiRes.body.grounded).toBe(false);
    expect(typeof aiRes.body.message).toBe('string');
    spy.mockRestore();
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { conversations, messages } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import {
  ensureOrg,
  ensureUser,
  ensureRole,
  grantRolePermission,
  assignUserRole,
  setAssistEntitlement,
} from '../utils/fixtures';

// Phase 15: report now includes a channel mix and previous-period totals for
// the KPI delta chips on the overview dashboard.
describe('Phase 15: report channel mix + comparison', () => {
  const app = createApp();
  let token: string;

  beforeAll(async () => {
    const org = await ensureOrg('Report Org', 'report-org');
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    const user = await ensureUser('report-reader@example.com', org.id);
    const role = await ensureRole('Report Reader', 'organization');
    await grantRolePermission(role.id, 'report.read');
    await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
    token = (await issueTokens({ id: user.id, organizationId: org.id, status: 'active' }))
      .accessToken;

    const [conv] = await db
      .insert(conversations)
      .values({ organizationId: org.id, channel: 'WEB', title: 'Report convo' })
      .returning();
    await db.insert(messages).values({
      conversationId: conv.id,
      organizationId: org.id,
      role: 'USER',
      content: 'hello',
    });
  });

  it('returns channel breakdown and previous-period totals', async () => {
    const res = await request(app)
      .get('/api/v1/reports/enquiries?days=30')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.conversations.byChannel).toBeInstanceOf(Array);
    expect(res.body.conversations.byChannel.length).toBeGreaterThanOrEqual(1);
    expect(res.body.conversations.byChannel[0]).toHaveProperty('channel');
    expect(res.body.conversations.byChannel[0]).toHaveProperty('count');
    expect(res.body.previous).toMatchObject({
      conversations: expect.any(Number),
      messages: expect.any(Number),
      leads: expect.any(Number),
      handoffs: expect.any(Number),
      appointments: expect.any(Number),
    });
  });
});

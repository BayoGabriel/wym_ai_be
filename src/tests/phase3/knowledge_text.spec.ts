import { describe, it, beforeAll, expect } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { knowledgeItems, auditEvents } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { eq } from 'drizzle-orm';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';

describe('Phase 3: Knowledge (TEXT)', () => {
  const app = createApp();
  let org: any;
  let token: string;
  let createdId: string;

  beforeAll(async () => {
    org = await ensureOrg('KnowOrg', 'know-org');
    const u = await ensureUser('knowadmin@example.com', org.id);

    const role = await ensureRole('Knowledge Tester', 'organization');
    for (const perm of ['knowledge.read', 'knowledge.write']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: u.id, roleId: role.id, organizationId: org.id });
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });

    token = (await issueTokens({ id: u.id, organizationId: org.id, status: 'active' })).accessToken;
  });

  it('creates text knowledge (DRAFT) and audits it', async () => {
    const res = await request(app)
      .post('/api/v1/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Business Hours',
        description: 'Support hours',
        content: 'Mon-Fri 8-5',
        category: 'GENERAL',
        status: 'DRAFT',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    createdId = res.body.id;
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'knowledge.created'))
      .limit(1);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('retrieves created knowledge by id', async () => {
    const res = await request(app)
      .get(`/api/v1/knowledge/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Business Hours');
  });

  it('lists knowledge with pagination and filtering', async () => {
    const res = await request(app)
      .get('/api/v1/knowledge?category=GENERAL&status=DRAFT&page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.page).toBe(1);
  });

  it('updates knowledge to ACTIVE', async () => {
    const res = await request(app)
      .patch(`/api/v1/knowledge/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('archives knowledge (DELETE -> ARCHIVED)', async () => {
    const res = await request(app)
      .delete(`/api/v1/knowledge/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    const [row] = await db
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, createdId))
      .limit(1);
    expect(row.status).toBe('ARCHIVED');
  });
});

import { describe, it, beforeAll, expect } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { knowledgeChunks } from '../../database/schema/core';
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

describe('Phase 4: Knowledge Processing - TEXT', () => {
  const app = createApp();
  let org: any;
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    org = await ensureOrg('ProcTextOrg', 'proc-text-org');
    const u = await ensureUser('proctext@example.com', org.id);

    const role = await ensureRole('Knowledge Tester', 'organization');
    for (const perm of ['knowledge.read', 'knowledge.write']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: u.id, roleId: role.id, organizationId: org.id });
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });

    token = (await issueTokens({ id: u.id, organizationId: org.id, status: 'active' })).accessToken;
  });

  it('creates a TEXT knowledge and processes it into chunks deterministically', async () => {
    const content = 'Heading\n\nParagraph A. Paragraph B continues.\n\nParagraph C.';
    const res = await request(app)
      .post('/api/v1/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'ProcText',
        description: 'Text processing',
        content,
        category: 'GENERAL',
        status: 'ACTIVE',
      });
    expect(res.status).toBe(201);
    itemId = res.body.id;

    const p = await request(app)
      .post(`/api/v1/knowledge/${itemId}/process`)
      .set('Authorization', `Bearer ${token}`);
    expect(p.status).toBe(200);
    expect(p.body.processingStatus).toBe('COMPLETED');

    const rows = await db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeItemId, itemId));
    expect(rows.length).toBeGreaterThan(0);
    const ordered = [...rows].sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);
    expect(ordered.map((r: any) => r.chunkIndex)).toEqual(ordered.map((_: any, i: number) => i));
    expect(
      ordered.every((r: any) => typeof r.content === 'string' && r.content.trim().length > 0)
    ).toBe(true);
  });

  it('reprocessing replaces old chunks', async () => {
    const updated = await request(app)
      .patch(`/api/v1/knowledge/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'New content A. New content B. New content C.' });
    expect(updated.status).toBe(200);

    const proc = await request(app)
      .post(`/api/v1/knowledge/${itemId}/process`)
      .set('Authorization', `Bearer ${token}`);
    expect(proc.status).toBe(200);

    const rows = await db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeItemId, itemId));
    expect(rows.length).toBeGreaterThan(0);
    const all = rows.map((r: any) => r.content).join(' ');
    expect(all).toContain('New content A');
  });
});
